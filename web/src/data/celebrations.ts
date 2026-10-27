/**
 * Celebrations (Celebrations.swift): short, physical beats that grow out of a
 * live moment's own mark. Confetti fans out of the end zone, fireworks go up
 * at the fence, sparks ray out of a run scoring. Intensity follows the
 * moment's tier.
 *
 * Every primitive is a pure function of (seed, t) with closed-form physics,
 * so any frame can be drawn on its own (tests draw t = 0.2 without playing
 * 0…0.2). The stage (`features/game/core/CelebrationStage.tsx`) drives a
 * canvas with requestAnimationFrame only while a burst plays, over the chart,
 * clipped to its well. When it ends the chart is pixel-identical to a chart
 * with no celebration. At most 36 particles per burst.
 *
 * Deviations from the Swift: the seed is 32-bit FNV-1a and the generator is
 * SplitMix32 (JavaScript has no cheap 64-bit integers), so a moment's burst
 * is stable per ID but not identical to the Mac's. Each effect's random draws
 * are made once per cue and cached (`particles` stays pure: the cache is keyed
 * by the cue), not redrawn per frame.
 *
 *     const cue = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: -Math.PI / 2 });
 *     drawParticles(ctx, particles(cue, origin, t), palette);
 */
import { decisive, Tier, type LiveMoment } from "./moments";

/** How much a live page celebrates (Settings, Live Games). */
export type CelebrationLevel = "full" | "subtle" | "off";

/** Between particle bursts (confetti, fireworks), per page. */
export const COOLDOWN_MS = 10_000;
/** The most particles one burst draws in a frame. */
export const PARTICLE_CAP = 36;

const DEG = Math.PI / 180;

// MARK: - Curves

/** A CSS cubic-bezier as a function of x (WebKit's UnitBezier, Newton then bisection). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
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
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
      if (hi - lo < 1e-7) break;
    }
    return sampleY(t);
  };
}

/** The house ease-out (0.23, 1, 0.32, 1), to evaluate inside a canvas (Motion.curve). */
export const houseCurve = bezier(0.23, 1, 0.32, 1);
/** A band moving across a surface (Motion.sweep's curve). */
export const sweepCurve = bezier(0.77, 0, 0.175, 1);
/** SwiftUI's `.easeInOut` (Motion.settle). */
export const settleCurve = bezier(0.42, 0, 0.58, 1);
/** SwiftUI's `.easeOut`. */
export const easeOutCurve = bezier(0, 0, 0.58, 1);

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const curve = (x: number) => houseCurve(clamp01(x));

// MARK: - Cue

/** Confetti physics by stage height. */
export type Preset = "short" | "medium" | "tall";

export function presetFor(height: number): Preset {
  return height < 100 ? "short" : height >= 200 ? "tall" : "medium";
}

// Tuned in the Swift after frame review: heavy drag and a low terminal
// velocity make short and medium pop out, then float; tall sprays out, then
// drops down the wall.
const PRESET = {
  short: { count: 18, speed: 150, gravity: 160, drag: 4.0 },
  medium: { count: 24, speed: 200, gravity: 220, drag: 3.6 },
  tall: { count: 28, speed: 170, gravity: 420, drag: 2.2 },
} as const satisfies Record<Preset, { count: number; speed: number; gravity: number; drag: number }>;

export type Effect =
  /** The signature for touchdowns, goals, tops and buzzer-beaters. Angles in radians, y down. */
  | { readonly kind: "confetti"; readonly direction: number; readonly spread: number; readonly preset: Preset }
  /** Baseball's signature, at the fence. */
  | { readonly kind: "fireworks"; readonly shells: number }
  /** The accent for swing moments, and the calm stand-in for a burst. Rays start `base` pt out. */
  | { readonly kind: "sparks"; readonly rays: number; readonly length: number; readonly base: number }
  /** The ball drops through and the net ripples, from 0.4 s; with `echo`, an and-one ring after. */
  | { readonly kind: "swish"; readonly echo: boolean }
  /** The and-one ring alone. */
  | { readonly kind: "echo" }
  /** The dunk: the ball drops onto the rim and the ring rings. */
  | { readonly kind: "rimPulse" }
  /** On fire: six embers rise from the rim. */
  | { readonly kind: "embers" }
  /** A soft disc, no movement: Reduce Motion's stand-in for any burst. */
  | { readonly kind: "bloom"; readonly radius: number };

export const sparks = (rays: number, length: number, base = 3): Effect => ({ kind: "sparks", rays, length, base });

/** Confetti and fireworks: the effects the 10 s cooldown governs. */
export const isBurst = (e: Effect): boolean => e.kind === "confetti" || e.kind === "fireworks";

/** What the stage draws for a moment: pure data, decided once per moment. */
export interface CelebrationCue {
  readonly effects: readonly Effect[];
  /** Decisive: gold takes 15% of the particles, and confetti grows ×1.5 with a second wave. */
  readonly gold: boolean;
  /** FNV-1a of the moment's ID: the same moment always draws the same burst. */
  readonly seed: number;
  /** When the chart's own data motion lands (the ball reaching the end zone). */
  readonly delay: number;
  /** Rays in ink at 0.8 instead of team colors: a save is the keeper's, not the shooter's. */
  readonly glint: boolean;
  /** Subtle's lighter swish and rim. */
  readonly subtle: boolean;
}

export const cueBursts = (cue: CelebrationCue): boolean => cue.effects.some(isBurst);

/** When effect `index` starts, after `delay`: anything following a swish or rim pulse waits for the ball to reach the rim. */
export function effectStart(cue: CelebrationCue, index: number): number {
  for (const earlier of cue.effects.slice(0, index)) {
    if (earlier.kind === "swish") return cue.effects[index]?.kind === "sparks" ? 0.42 : 0.4;
    if (earlier.kind === "rimPulse") return 0.12;
  }
  return 0;
}

/** How long one effect plays (seconds). */
export function effectLength(cue: CelebrationCue, effect: Effect): number {
  switch (effect.kind) {
    case "confetti":
      return 0.06 + 1.24 + (cue.gold ? 0.18 : 0);
    case "fireworks":
      return 0.22 * (Math.min(Math.max(effect.shells, 1), 3) - 1) + 0.95;
    case "sparks":
      return 0.38;
    case "swish":
      return cue.subtle ? 0.9 : effect.echo ? 1.3 : 0.99;
    case "echo":
      return 0.5;
    case "rimPulse":
      return 0.72;
    case "embers":
      return 0.76;
    case "bloom":
      return 0.95;
  }
}

/** Seconds from mount until the last particle is gone. */
export function cueDuration(cue: CelebrationCue): number {
  let end = 0;
  cue.effects.forEach((e, i) => (end = Math.max(end, effectStart(cue, i) + effectLength(cue, e))));
  return cue.delay + end;
}

/** The most particles effects other than confetti or fireworks draw at once. */
function reserved(cue: CelebrationCue, excluding: number): number {
  return cue.effects.reduce((sum, e, i) => {
    if (i === excluding) return sum;
    switch (e.kind) {
      case "sparks":
        return sum + e.rays;
      case "swish":
        return sum + (e.echo ? 4 : 3);
      case "echo":
      case "bloom":
        return sum + 1;
      case "rimPulse":
        return sum + 2;
      case "embers":
        return sum + 6;
      default:
        return sum;
    }
  }, 0);
}

export interface CueOptions {
  readonly level: CelebrationLevel;
  readonly reduceMotion: boolean;
  readonly preset: Preset;
  /** Which way confetti flies, radians (y down): into the field from an end zone, up from a rim (−π/2). */
  readonly direction: number;
  /** Replaces the table's effects for this moment (still filtered by level, Reduce Motion and the cooldown). */
  readonly effects?: readonly Effect[];
}

/**
 * The cue for a moment, with the substitutions applied: Off draws nothing;
 * Reduce Motion draws one bloom; Subtle and a moment inside the cooldown
 * (`burst == false`) trade confetti and fireworks for sparks. Null means the
 * stage draws nothing (the chart keeps its own marks and pings).
 */
export function cueFor(m: LiveMoment, options: CueOptions): CelebrationCue | null {
  if (options.level === "off") return null;
  let cue = table(m, options.preset, options.direction);
  if (options.effects) cue = { ...cue, effects: options.effects };
  if (cue.effects.length === 0) return null;
  if (options.reduceMotion) {
    // Nothing travels, scales or spins: a soft disc where it happened.
    return { effects: [{ kind: "bloom", radius: cueBursts(cue) ? 22 : 14 }], gold: false, seed: cue.seed, delay: cue.delay, glint: false, subtle: false };
  }
  if (options.level === "subtle") {
    return {
      ...cue,
      subtle: true,
      effects: cue.effects.flatMap((e): Effect[] => {
        if (isBurst(e)) return [sparks(8, 13)];
        if (e.kind === "sparks") return [sparks(4, e.length, e.base)];
        if (e.kind === "embers") return [];
        return [e];
      }),
    };
  }
  if (!m.burst) return { ...cue, effects: cue.effects.map((e) => (isBurst(e) ? sparks(8, 13) : e)) };
  return cue;
}

/** Whether this moment's celebration would be a particle burst at Full, so the moment slot can hold it to one every 10 s. */
export function wantsBurst(m: LiveMoment): boolean {
  return cueBursts(table(m, "medium", -Math.PI / 2)) || theaterBursts(m);
}

/** The plays the theater's banner celebrates with confetti beyond the table: a triple, and a walk-off that isn't a home run. */
export function theaterBursts(m: LiveMoment): boolean {
  return m.chart === "plate" && (m.accents.has("triple") || (decisive(m) && m.tier === Tier.score));
}

/** The Swift spec's table at Full, before substitutions. */
function table(m: LiveMoment, preset: Preset, direction: number): CelebrationCue {
  const a = m.accents;
  // Decisive is an accent on a score; on anything else it's ignored.
  const isDecisive = decisive(m) && m.tier === Tier.score;
  let effects: Effect[] = [];
  let delay = 0;
  let glint = false;
  const confetti = (spread: number): Effect => ({ kind: "confetti", direction, spread: spread * DEG, preset });
  switch (m.kind) {
    // Football: the burst waits for the ball to reach the end zone.
    case "touchdown":
      effects = [confetti(55)];
      delay = 0.4;
      break;
    case "fieldGoal":
      effects = [sparks(6, 16)];
      delay = 0.4;
      break;
    case "safety":
      effects = [{ kind: "bloom", radius: 22 }];
      delay = 0.35;
      break;
    case "passComplete":
    case "rush":
      if (a.has("bigPlay")) {
        effects = [sparks(4, 9)];
        delay = 0.3;
      }
      break;
    // Soccer: after the shot's path reaches the goal.
    case "goal":
      effects = [confetti(55)];
      delay = 0.4;
      break;
    case "shotSaved":
      effects = [sparks(4, 9)];
      delay = 0.35;
      glint = true;
      break;
    case "shotWide":
      if (a.has("woodwork")) {
        effects = [sparks(4, 9)];
        delay = 0.35;
      }
      break;
    // Baseball.
    case "homeRun":
      effects = [{ kind: "fireworks", shells: isDecisive ? 3 : a.has("grandSlam") ? 2 : 1 }];
      delay = 0.35;
      break;
    case "runScored":
      effects = [sparks(6, 13)];
      break;
    // Basketball: the stage's swish starts where the shot's flight ends.
    case "made": {
      effects = [a.has("dunk") ? { kind: "rimPulse" } : { kind: "swish", echo: a.has("andOne") }];
      if ((m.value ?? 2) >= 3) effects.push(sparks(6, 13));
      else if (a.has("clutch")) effects.push(sparks(4, 13));
      if (a.has("onFire")) effects.push({ kind: "embers" });
      if (a.has("buzzer")) effects.push({ kind: "confetti", direction, spread: 60 * DEG, preset: "medium" });
      break;
    }
    case "run":
    case "leadChange":
      effects = [sparks(4, 9)];
      break;
    // Climbing.
    case "passed":
      if (a.has("newLeader")) {
        effects = [sparks(6, 13)];
        delay = 0.3;
      }
      break;
    case "top":
      if (m.chart === "ascent") {
        // After the summit flag plants.
        effects = [confetti(80)];
        delay = 0.25;
      } else if (m.chart === "boulder") {
        // Clear of the 14 × 26 cell's corners, at its center.
        effects = [a.has("flash") ? sparks(8, 11, 14) : sparks(6, 9, 14)];
      } else {
        effects = [sparks(6, 9)];
      }
      break;
    default:
      // Marks only: turnovers, sacks, misses, blocks, steals, rounds, cards.
      break;
  }
  let gold = m.kind === "top" && a.has("flash");
  if (isDecisive) {
    gold = true;
    // A decisive score always gets the signature, on charts with a well to hold it.
    if (!effects.some(isBurst) && (["field", "pitch", "ascent", "court"] as const).includes(m.chart as "field")) {
      effects.push(confetti(m.chart === "ascent" ? 80 : 55));
    }
  }
  return { effects, gold, seed: seed(m.id), delay, glint, subtle: false };
}

/** FNV-1a 32-bit. Stable across loads. */
export function seed(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** SplitMix32: tiny, fast and identical on every run for the same seed. */
export class SplitMix32 {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x9e3779b9) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  }
  /** Uniform in [lo, hi]. */
  in(lo: number, hi: number): number {
    return lo + (this.next() / 0x1_0000_0000) * (hi - lo);
  }
  sign(): number {
    return (this.next() & 1) === 0 ? 1 : -1;
  }
}

// MARK: - Particles

export type Ink = "primary" | "tint" | "neutral" | "gold" | "glint" | { readonly ember: number };

export type ParticleShape =
  /** A confetti piece, drawn rotated by `angle`. */
  | { readonly kind: "piece"; readonly w: number; readonly h: number; readonly corner: number }
  /** A ray or a firework trail, round-capped. */
  | { readonly kind: "streak"; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly width: number }
  | { readonly kind: "ring"; readonly radius: number; readonly width: number }
  | { readonly kind: "disc"; readonly radius: number }
  /** The ball: an ink disc with a 1 pt edge. */
  | { readonly kind: "ball"; readonly radius: number };

export interface Particle {
  readonly shape: ParticleShape;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly opacity: number;
  readonly ink: Ink;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Drag and gravity, closed form (y down). */
function ballistic(p: Point, vx: number, vy: number, g: number, k: number, t: number): Point {
  const e = (1 - Math.exp(-k * t)) / k;
  return { x: p.x + vx * e, y: p.y + (g / k) * t + (vy - g / k) * e };
}

/** Holds at 1, then dissolves over the last 45% of life (smoothstep): on a particle that reads as a fade, not a blink. */
function fade(age: number, life: number): number {
  const x = clamp01((age / life - 0.55) / 0.45);
  return 1 - x * x * (3 - 2 * x);
}

/** Primary 50%, tint 25%, neutral 25%; decisive: gold takes 15 of the neutral 25. */
function inkFor(i: number, gold: boolean): Ink {
  const slot = (i * 13 + 5) % 20;
  if (slot < 10) return "primary";
  if (slot < 15) return "tint";
  if (slot < 18 && gold) return "gold";
  return "neutral";
}

interface ConfettiDraw {
  birth: number;
  life: number;
  speed: number;
  theta: number;
  spin0: number;
  spin: number;
  phase: number;
  flutterRate: number;
}

interface ShellDraw {
  dx: number;
  dy: number;
  turn: number;
  rays: { theta: number; speed: number; life: number }[];
}

interface EmberDraw {
  birth: number;
  vx: number;
  vy: number;
}

/** Each effect's random draws, made once per cue (they don't depend on t). */
const draws = new WeakMap<CelebrationCue, unknown[]>();

function drawsFor(cue: CelebrationCue): unknown[] {
  const cached = draws.get(cue);
  if (cached) return cached;
  const made = cue.effects.map((effect, index) => {
    const random = new SplitMix32((cue.seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0);
    switch (effect.kind) {
      case "confetti": {
        const first = PRESET[effect.preset].count;
        const count = Math.max(0, Math.min(cue.gold ? first + Math.floor(first / 2) : first, PARTICLE_CAP - reserved(cue, index)));
        return Array.from({ length: count }, (_, i): ConfettiDraw => ({
          birth: random.in(0, 0.06) + (i >= first ? 0.18 : 0),
          life: random.in(0.9, 1.24),
          speed: PRESET[effect.preset].speed * random.in(0.75, 1.25),
          theta: effect.direction + effect.spread * random.in(-1, 1),
          spin0: random.in(0, 2 * Math.PI),
          spin: random.in(3, 9) * random.sign(),
          phase: random.in(0, 2 * Math.PI),
          flutterRate: random.in(8, 14),
        }));
      }
      case "fireworks": {
        const shells = Math.min(Math.max(effect.shells, 1), 3);
        const perShell = Math.max(4, Math.min(14, Math.floor((PARTICLE_CAP - reserved(cue, index)) / shells) - 1));
        return Array.from({ length: shells }, (_, shell): ShellDraw => ({
          dx: shell === 0 ? 0 : random.in(-14, 14),
          dy: shell === 0 ? 0 : random.in(-10, 4),
          turn: random.in(0, 2 * Math.PI),
          rays: Array.from({ length: perShell }, (_, j) => ({
            theta: 2 * Math.PI * (j / perShell) + random.in(-8, 8) * DEG,
            speed: random.in(60, 95),
            life: random.in(0.75, 0.95),
          })),
        }));
      }
      case "sparks":
        return random.in(0, 1);
      case "embers":
        return Array.from({ length: 6 }, (): EmberDraw => ({ birth: random.in(0, 0.06), vx: random.in(-20, 20), vy: random.in(-70, -40) }));
      default:
        return null;
    }
  });
  draws.set(cue, made);
  return made;
}

/** Every particle of `cue` at `t` seconds after mount, with `origin` in the drawing's coordinates. */
export function particles(cue: CelebrationCue, origin: Point, t: number): Particle[] {
  const local = t - cue.delay;
  if (local < 0) return [];
  const out: Particle[] = [];
  const all = drawsFor(cue);
  cue.effects.forEach((effect, index) => {
    const age = local - effectStart(cue, index);
    if (age < 0 || age > effectLength(cue, effect)) return;
    const d = all[index];
    switch (effect.kind) {
      case "confetti":
        confetti(out, d as ConfettiDraw[], origin, age, effect.preset, cue.gold);
        break;
      case "fireworks":
        fireworks(out, d as ShellDraw[], origin, age, cue.gold);
        break;
      case "sparks":
        sparkRays(out, d as number, origin, age, effect.rays, effect.length, effect.base, cue.gold, cue.glint);
        break;
      case "swish": {
        const drop = (age - 0.4) / 0.12;
        if (drop >= 0 && drop <= 1) {
          const c = curve(drop);
          out.push({ shape: { kind: "ball", radius: 2.5 * (1 - 0.5 * c) }, x: origin.x, y: origin.y, angle: 0, opacity: 1 - c, ink: "primary" });
        }
        ripple(out, origin, age - 0.4, 11);
        if (!cue.subtle) {
          ripple(out, origin, age - 0.49, 16);
          if (effect.echo) ripple(out, origin, age - 0.8, 9);
        }
        break;
      }
      case "echo":
        ripple(out, origin, age, 9);
        break;
      case "rimPulse":
        rimPulse(out, origin, age, cue.subtle);
        break;
      case "embers":
        embers(out, d as EmberDraw[], origin, age);
        break;
      case "bloom": {
        const o = age < 0.15 ? curve(age / 0.15) : age < 0.35 ? 1 : 1 - curve((age - 0.35) / 0.6);
        out.push({ shape: { kind: "disc", radius: effect.radius }, x: origin.x, y: origin.y, angle: 0, opacity: 0.2 * o, ink: "primary" });
        break;
      }
    }
  });
  if (out.length > PARTICLE_CAP) out.length = PARTICLE_CAP;
  return out;
}

function confetti(out: Particle[], d: readonly ConfettiDraw[], origin: Point, age: number, preset: Preset, gold: boolean): void {
  const p = PRESET[preset];
  d.forEach((c, i) => {
    const t = age - c.birth;
    if (t < 0 || t > c.life) return;
    const at = ballistic(origin, c.speed * Math.cos(c.theta), c.speed * Math.sin(c.theta), p.gravity, p.drag, t);
    // Born at 60%, never from nothing.
    const grow = t < 0.08 ? 0.6 + 0.4 * curve(t / 0.08) : 1;
    // Width breathing with |cos| fakes a 3D tumble without 3D.
    const flutter = 0.25 + 0.75 * Math.abs(Math.cos(c.phase + c.flutterRate * t));
    // 60% rectangles, 25% discs, 15% streamers.
    const kind = (i * 7 + 2) % 20;
    const [w, h, corner] = kind < 12 ? [2.5, 5, 0.75] : kind < 17 ? [3, 3, 1.5] : [1.5, 7, 0.75];
    out.push({
      shape: { kind: "piece", w: w * flutter * grow, h: h * grow, corner: corner * grow },
      x: at.x,
      y: at.y,
      angle: c.spin0 + c.spin * t,
      opacity: fade(t, c.life),
      ink: inkFor(i, gold),
    });
  });
}

function fireworks(out: Particle[], shells: readonly ShellDraw[], origin: Point, age: number, gold: boolean): void {
  shells.forEach((shell, s) => {
    const t = age - 0.22 * s;
    const center = { x: origin.x + shell.dx, y: origin.y + shell.dy };
    if (t >= 0 && t <= 0.18) {
      const c = curve(t / 0.18);
      out.push({ shape: { kind: "disc", radius: 2 * (0.6 + c) }, x: center.x, y: center.y, angle: 0, opacity: 1 - c, ink: "tint" });
    }
    shell.rays.forEach((ray, j) => {
      if (t < 0 || t > ray.life) return;
      const theta = shell.turn + ray.theta;
      const vx = ray.speed * Math.cos(theta);
      const vy = ray.speed * Math.sin(theta);
      const head = ballistic(center, vx, vy, 140, 2.4, t);
      const tail = ballistic(center, vx, vy, 140, 2.4, Math.max(0, t - 0.05));
      out.push({
        shape: { kind: "streak", x0: tail.x, y0: tail.y, x1: head.x, y1: head.y, width: 1.5 - (0.75 * t) / ray.life },
        x: head.x,
        y: head.y,
        angle: 0,
        opacity: fade(t, ray.life),
        ink: inkFor(s * shell.rays.length + j, gold),
      });
    });
  });
}

/**
 * Rays shoot out from just outside the mark and vanish tail-first: a ray
 * grows from its base, it never scales a shape up from nothing. A cubic
 * ease-out over 0.26 s, the tail 0.1 s behind; gone by 0.36 s.
 */
function sparkRays(out: Particle[], spin: number, origin: Point, age: number, rays: number, length: number, base: number, gold: boolean, glint: boolean): void {
  const turn = (spin * 2 * Math.PI) / Math.max(rays, 1);
  const out3 = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
  const head = base + length * out3(age / 0.26);
  const tail = base + length * out3((age - 0.1) / 0.26);
  const span = head - tail;
  if (span <= 0.05) return;
  for (let r = 0; r < rays; r++) {
    const theta = turn + (2 * Math.PI * r) / rays;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    const ink: Ink = glint ? "glint" : r % 2 === 0 ? "primary" : gold ? "gold" : "tint";
    out.push({
      shape: { kind: "streak", x0: origin.x + ux * tail, y0: origin.y + uy * tail, x1: origin.x + ux * head, y1: origin.y + uy * head, width: 1.25 },
      x: origin.x,
      y: origin.y,
      angle: 0,
      opacity: Math.min(1, span / 2),
      ink,
    });
  }
}

/** One ring from the rim: radius 2.5 to `reach`, stroke 1.5 to 0.5, opacity 0.9 to 0 over 0.5 s. */
function ripple(out: Particle[], origin: Point, age: number, reach: number): void {
  if (age < 0 || age > 0.5) return;
  const f = age / 0.5;
  const spread = 1 - Math.pow(1 - f, 3);
  out.push({ shape: { kind: "ring", radius: 2.5 + (reach - 2.5) * spread, width: 1.5 - f }, x: origin.x, y: origin.y, angle: 0, opacity: 0.9 * (1 - f), ink: "primary" });
}

/** The rim's ring scale: out to 1.7 in 0.1 s, then a lightly bouncing spring home (Subtle: 1.35 and no bounce). */
function rimRing(t: number, subtle: boolean): number {
  if (t <= 0.1) return 1 + (subtle ? 0.35 : 0.7) * curve(t / 0.1);
  const u = Math.min((t - 0.1) / 0.3, 1);
  if (subtle) return 1.35 - 0.35 * settleCurve(u);
  // A 0.3 s spring with 0.3 bounce, from 1.7 to 1.
  const omega = (2 * Math.PI) / 0.3;
  const zeta = 1 - 0.3;
  const s = t - 0.1;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 + 0.7 * Math.exp(-zeta * omega * s) * (Math.cos(wd * s) + ((zeta * omega) / wd) * Math.sin(wd * s));
}

function rimPulse(out: Particle[], origin: Point, age: number, subtle: boolean): void {
  if (age <= 0.24) {
    // Drops 12 pt onto the rim on a critically damped 0.2 s spring, then through it.
    const omega = (2 * Math.PI) / 0.2;
    const s = 1 - (1 + omega * age) * Math.exp(-omega * age);
    const through = curve((age - 0.12) / 0.12);
    out.push({ shape: { kind: "ball", radius: 2.5 * (1 - 0.5 * through) }, x: origin.x, y: origin.y - 12 * (1 - s), angle: 0, opacity: 1 - through, ink: "primary" });
  }
  const ring = age - 0.12;
  if (ring < 0 || ring > 0.6) return;
  const opacity = ring < 0.3 ? 1 : 1 - curve((ring - 0.3) / 0.3);
  out.push({ shape: { kind: "ring", radius: 3 * rimRing(ring, subtle), width: 2 }, x: origin.x, y: origin.y, angle: 0, opacity, ink: "primary" });
}

function embers(out: Particle[], d: readonly EmberDraw[], origin: Point, age: number): void {
  for (const e of d) {
    const t = age - e.birth;
    if (t < 0 || t > 0.7) continue;
    const at = ballistic(origin, e.vx, e.vy, -30, 1.5, t);
    out.push({ shape: { kind: "disc", radius: 1 }, x: at.x, y: at.y, angle: 0, opacity: fade(t, 0.7), ink: { ember: t / 0.7 } });
  }
}

// MARK: - Drawing

/** Resolved colors for a burst: the scorer's color and its tint, plus the page's ink. */
export interface CelebrationPalette {
  readonly primary: string;
  readonly tint: string;
  /** Ink at 0.55 (Viz.neutral). */
  readonly neutral: string;
  readonly gold: string;
  /** Ink at 0.8: a white glint in dark mode. */
  readonly glint: string;
  /** The ball's 1 pt edge: ink at 0.5. */
  readonly edge: string;
}

/** Orange turning gold over an ember's life. */
function emberColor(f: number): string {
  const c = clamp01(f);
  // systemOrange → systemYellow
  const r = 255;
  const g = Math.round(149 + (204 - 149) * c);
  const b = Math.round(0 + (0 - 0) * c);
  return `rgb(${r} ${g} ${b})`;
}

/** Draws particles into a 2D canvas context: one fill or stroke each. */
export function drawParticles(ctx: CanvasRenderingContext2D, list: readonly Particle[], palette: CelebrationPalette): void {
  if (list.length === 0) return;
  const shading = (ink: Ink): string => {
    if (typeof ink === "object") return emberColor(ink.ember);
    return palette[ink];
  };
  ctx.save();
  ctx.lineCap = "round";
  for (const p of list) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.opacity));
    const s = p.shape;
    switch (s.kind) {
      case "piece": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = shading(p.ink);
        ctx.beginPath();
        ctx.roundRect(-s.w / 2, -s.h / 2, s.w, s.h, Math.min(s.corner, s.w / 2, s.h / 2));
        ctx.fill();
        ctx.restore();
        break;
      }
      case "streak":
        ctx.strokeStyle = shading(p.ink);
        ctx.lineWidth = Math.max(s.width, 0.1);
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
        ctx.stroke();
        break;
      case "ring":
        ctx.strokeStyle = shading(p.ink);
        ctx.lineWidth = Math.max(s.width, 0.1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(s.radius, 0), 0, 2 * Math.PI);
        ctx.stroke();
        break;
      case "disc":
        ctx.fillStyle = shading(p.ink);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(s.radius, 0), 0, 2 * Math.PI);
        ctx.fill();
        break;
      case "ball":
        ctx.fillStyle = shading(p.ink);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(s.radius, 0), 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = palette.edge;
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
    }
  }
  ctx.restore();
}

// MARK: - The mark family's keyframes, as functions of time (seconds)

/** A pop: up to `peak` in 0.14 s, then a soft spring home (0.5 s total). */
export function popScale(t: number, peak: number, delay = 0): number {
  const u = t - delay;
  if (u <= 0) return 1;
  if (u <= 0.14) return 1 + (peak - 1) * bezier(0.42, 0, 0.58, 1)(u / 0.14);
  const s = u - 0.14;
  if (s >= 0.36) return 1;
  // Spring(duration 0.36, bounce 0.25) from peak to 1.
  const omega = (2 * Math.PI) / 0.36;
  const zeta = 0.75;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 + (peak - 1) * Math.exp(-zeta * omega * s) * (Math.cos(wd * s) + ((zeta * omega) / wd) * Math.sin(wd * s));
}

/** The score pill's opacity: in 0.15 s on the house curve, hold 1.6 s, out over `fadeOut` (1.2 s; 0.3 with Reduce Motion). */
export function pillOpacity(t: number, peak = 1, fadeOut = 1.2): number {
  if (t <= 0) return 0;
  if (t <= 0.15) return peak * curve(t / 0.15);
  if (t <= 1.75) return peak;
  const u = (t - 1.75) / fadeOut;
  return u >= 1 ? 0 : peak * (1 - easeOutCurve(u));
}

/** The hero wash pulse: rise (0.25 s; 0.4 with Reduce Motion), hold 0.3 s, a slow 1 s decay. */
export function washPulse(t: number, rise = 0.25): number {
  if (t <= 0) return 0;
  if (t <= rise) return curve(t / rise);
  if (t <= rise + 0.3) return 1;
  const u = (t - rise - 0.3) / 1;
  return u >= 1 ? 0 : 1 - settleCurve(u);
}

/** The glint's progress across its surface: waits 0.3 s for the pop, then sweeps in 0.7 s. */
export function glintProgress(t: number): number {
  if (t <= 0.3) return 0;
  return sweepCurve(clamp01((t - 0.3) / 0.7));
}

/** Samples `f` over `duration` seconds into WAAPI-ready offsets (60 per second). */
export function sample(f: (t: number) => number, duration: number, fps = 60): { offset: number; value: number }[] {
  const steps = Math.max(2, Math.ceil(duration * fps));
  return Array.from({ length: steps + 1 }, (_, i) => ({ offset: i / steps, value: f((i / steps) * duration) }));
}
