/**
 * The play theater's choreography (PlayScript.swift): a `PlayScene` turned
 * into every figure's path, the ball's flights and the beats (contact, outs,
 * runs, the stamp), in feet and seconds from the pitch. Built once per play;
 * any frame is a pure function of the script and t, so a still can draw
 * t = 1.4 without playing 0…1.4, and the tests can check that a 6-3's throw
 * beats the runner.
 *
 * Time is a broadcast replay's, not the game's: the delivery and the pitch in
 * real time (0.4 s at 95 mph), everything after it about four times faster,
 * and the runners are paced to the outcome the scorer recorded (out by a step
 * at first; safe with room to spare). A replay runs 2–4 s, then the field
 * settles: fielders walk back, runners take their leads, the next batter
 * steps in.
 *
 * The script also says what each figure does (the windup, a catch, a throw,
 * a slide), when the headline lands, and where the broadcast camera looks
 * (playCamera.ts).
 *
 *     const script = PlayScript.play(scene, { bases: scene.basesAfter, bats: "R", swapped: scene.endsInning });
 *     script.ball(1.2); script.camera.frame(1.2);
 */
import { CameraFrame, CameraTrack, shoot, type Shot } from "./playCamera";
import { coverer, isOut, type Hand, type PlayScene } from "./playScene";
import { Ballpark, distanceBetween, easeValue, fieldPoint, ground, ORIGIN, samePoint, type Ease, type FieldPoint, type Point } from "./theaterField";
import { RigTrack, type RigFacing } from "../theater/rig";

export type Team = "fielding" | "batting";

/** A walk or run along a path, from `start` to `end`. */
export class Move {
  readonly start: number;
  readonly end: number;
  readonly path: readonly Point[];
  readonly ease: Ease;
  /** Each leg's length, and the whole: measured once, not every frame. */
  readonly lengths: readonly number[];
  readonly length: number;

  constructor(start: number, end: number, path: readonly Point[], ease: Ease = "inOut") {
    this.start = start;
    this.end = end;
    this.path = path;
    this.ease = ease;
    const lengths: number[] = [];
    for (let i = 0; i + 1 < path.length; i++) lengths.push(distanceBetween(path[i]!, path[i + 1]!));
    this.lengths = lengths;
    this.length = lengths.reduce((a, b) => a + b, 0);
  }

  point(t: number): Point {
    if (this.path.length <= 1) return this.path[0] ?? ORIGIN;
    const u = easeValue(this.ease, this.end > this.start ? (t - this.start) / (this.end - this.start) : 1);
    let remaining = u * this.length;
    for (let i = 0; i < this.lengths.length; i++) {
      const length = this.lengths[i]!;
      if (remaining <= length || i === this.lengths.length - 1) {
        const f = length > 0 ? Math.min(remaining / length, 1) : 1;
        const a = this.path[i]!;
        const b = this.path[i + 1]!;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      remaining -= length;
    }
    return this.path[this.path.length - 1]!;
  }
}

/** Who a figure is on this play: his pose follows from it. */
export type Role =
  /** By scorer's number (1: the pitcher, 2: the catcher). */
  | { readonly kind: "fielder"; readonly n: number }
  | { readonly kind: "batter" }
  | { readonly kind: "runner" };

/** A moment of the play in his hands. */
export interface Action {
  /** catchHigh: a fly or a pop-up, gloved over his head. scoop: a ground ball at his feet. glove: a throw or a liner at his chest. */
  readonly kind: "catchHigh" | "scoop" | "glove" | "throwBall";
  readonly at: number;
  /** Where the ball comes from or goes: he turns to face it. */
  readonly toward: Point;
}

export class Actor {
  static readonly fade = 0.3;

  team: Team;
  at: Point;
  role: Role;
  moves: Move[] = [];
  /** Fades in from `appear` and out from `vanish`, over `Actor.fade`. */
  appear = -Infinity;
  vanish = Infinity;
  crouch = false;
  /** The batter: his side, when he swings, when he drops the bat. */
  bats: Hand | null = null;
  swing: number | null = null;
  dropsBat: number | null = null;
  actions: Action[] = [];
  /** Feet first into a base, from this moment until he's gone or settled. */
  slide: number | null = null;

  constructor(team: Team, at: Point, role: Role = { kind: "runner" }, options: { crouch?: boolean; bats?: Hand | null; appear?: number } = {}) {
    this.team = team;
    this.at = at;
    this.role = role;
    this.crouch = options.crouch ?? false;
    this.bats = options.bats ?? null;
    if (options.appear != null) this.appear = options.appear;
  }

  /** The newest move that has begun wins: a later move starts from wherever the one before had got to. */
  position(t: number): Point {
    let move: Move | undefined;
    for (let i = this.moves.length - 1; i >= 0; i--) {
      if (t >= this.moves[i]!.start) {
        move = this.moves[i];
        break;
      }
    }
    if (!move) return this.at;
    return t < move.end ? move.point(t) : (move.path[move.path.length - 1] ?? this.at);
  }

  opacity(t: number): number {
    const fadeIn = Number.isFinite(this.appear) ? Math.min(Math.max((t - this.appear) / Actor.fade, 0), 1) : 1;
    const fadeOut = Number.isFinite(this.vanish) ? 1 - Math.min(Math.max((t - this.vanish) / Actor.fade, 0), 1) : 1;
    return fadeIn * fadeOut;
  }

  /** Running, not walking: a stride's bob. */
  running(t: number): boolean {
    return this.moves.some((m) => t > m.start && t < m.end && m.length / (m.end - m.start) > 40);
  }

  /** Feet a second along the ground at t, and which way (null: standing). */
  motion(t: number): { speed: number; heading: Point } | null {
    let move: Move | undefined;
    for (let i = this.moves.length - 1; i >= 0; i--) {
      if (t >= this.moves[i]!.start) {
        move = this.moves[i];
        break;
      }
    }
    if (!move || !(t < move.end) || move.length <= 0.5) return null;
    const t0 = Math.max(t - 0.02, move.start);
    const t1 = Math.min(t + 0.02, move.end);
    const a = move.point(t0);
    const b = move.point(t1);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = t1 - t0;
    if (!(d > 0.01) || !(dt > 0)) return null;
    return { speed: d / dt, heading: { x: (b.x - a.x) / d, y: (b.y - a.y) / d } };
  }

  act(kind: Action["kind"], time: number, toward: Point): void {
    this.actions.push({ kind, at: time, toward });
  }

  move(path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    this.moves = this.moves.filter((m) => m.start < start);
    const origin = this.position(start);
    const last = path[path.length - 1];
    if (!last || !(Math.hypot(last.x - origin.x, last.y - origin.y) > 0.5 || path.length > 1)) return;
    this.moves.push(new Move(start, Math.max(end, start + 0.05), [origin, ...path], ease));
  }
}

export type Arc =
  /** A pitch or a carried ball: a gentle line. */
  | { readonly kind: "straight" }
  /** Bouncing along the ground, this many hops. */
  | { readonly kind: "bounce"; readonly hops: number }
  /** Up to `peak` feet over the line between its ends. */
  | { readonly kind: "arc"; readonly peak: number };

export class Flight {
  constructor(
    readonly start: number,
    readonly end: number,
    readonly from: FieldPoint,
    readonly to: FieldPoint,
    readonly arc: Arc,
    readonly ease: Ease = "linear",
  ) {}

  point(t: number): FieldPoint {
    const raw = this.end > this.start ? Math.min(Math.max((t - this.start) / (this.end - this.start), 0), 1) : 1;
    const u = easeValue(this.ease, raw);
    const { from, to } = this;
    const x = from.x + (to.x - from.x) * u;
    const y = from.y + (to.y - from.y) * u;
    let z = from.z + (to.z - from.z) * u;
    switch (this.arc.kind) {
      case "straight":
        break;
      case "bounce": {
        // Each hop lower than the last, from the bat down to the grass.
        const n = Math.max(this.arc.hops, 1);
        const phase = u * n;
        const hop = Math.floor(Math.min(phase, n - 0.0001));
        const local = phase - hop;
        const height = 9 * 0.45 ** hop * (1 - u * 0.5);
        z = Math.max(4 * height * local * (1 - local), 0) + from.z * Math.max(1 - phase * 3, 0);
        break;
      }
      case "arc":
        z += 4 * this.arc.peak * raw * (1 - raw);
        break;
    }
    return { x, y, z };
  }

  /** When a bouncing ball touches down between hops, and where: the dust puffs. (Found once, by sampling: the ease has no inverse.) */
  get bounces(): { at: number; point: Point }[] {
    if (this.arc.kind !== "bounce" || this.arc.hops <= 1 || !(this.end > this.start)) return [];
    const hops = this.arc.hops;
    const out: { at: number; point: Point }[] = [];
    let hop = 0;
    for (let i = 1; i <= 96; i++) {
      const raw = i / 96;
      const phase = easeValue(this.ease, raw) * hops;
      const whole = Math.trunc(phase);
      if (!(whole > hop && whole < hops)) continue;
      hop = whole;
      const t = this.start + raw * (this.end - this.start);
      out.push({ at: t, point: ground(this.point(t)) });
    }
    return out;
  }
}

/** Dust kicked up where a grounder touches down. */
export interface Puff {
  readonly at: number;
  readonly point: Point;
}

/**
 * The headline across the top of the field for a marquee play: HOME RUN,
 * TRIPLE, DOUBLE PLAY. It lands with the payoff and clears as the field
 * settles. Tones: hit (the batting team's color), gold (a grand slam or a
 * walk-off), out (neutral ink), strikeout (the app's red).
 */
export interface Banner {
  readonly text: string;
  readonly tone: "hit" | "gold" | "out" | "strikeout";
  readonly at: number;
  readonly until: number;
  /** It brings its own confetti (a triple, a home run, a walk-off). */
  readonly confetti: boolean;
}

export type Beat = "contact" | "out" | "run" | "catchBall" | "hitBatter";

export interface Flash {
  readonly beat: Beat;
  readonly at: number;
  readonly point: FieldPoint;
}

/** What's left where the ball went: the spray chart's marks. */
export type Mark = "hit" | "out" | "homeRun";

export interface Landing {
  readonly point: Point;
  readonly mark: Mark;
  readonly at: number;
}

export interface Fence {
  readonly at: number;
  readonly point: FieldPoint;
}

/** Between plays: who's where. */
export interface Rest {
  readonly bases: readonly [boolean, boolean, boolean] | readonly boolean[];
  /** The batter up, by his side (null: nobody in the box). */
  readonly bats: Hand | null;
  /** The half-inning ended: the batting team takes the field. */
  readonly swapped: boolean;
}

export const EMPTY_REST: Rest = { bases: [false, false, false], bats: null, swapped: false };

export class PlayScript {
  actors: Actor[] = [];
  flights: Flight[] = [];
  flashes: Flash[] = [];
  /** The batted ball's flight (traced), and where it came down. */
  batted: number | null = null;
  landing: Landing | null = null;
  /** When the scorer's mark appears. */
  stamp = Infinity;
  /** The pitch's type and speed, while it's in the air. */
  label: { readonly lower: number; readonly upper: number } | null = null;
  /** A home run clearing the fence: when, and where (for the fireworks). */
  fence: Fence | null = null;
  /** The ball is shown from the pitch until it fades from here. */
  ballFrom = 0;
  ballGone = Infinity;
  settle = 0;
  duration = 0;
  /** When the pitcher lets the pitch go (null: nobody pitched). */
  release: number | null = null;
  puffs: Puff[] = [];
  banner: Banner | null = null;
  /** The scorer's mark's corner of the view (bottom left), as fractions of its width and height: the camera keeps the play out of it. */
  corner = { width: 0, height: 0 };
  /** The broadcast camera, shot by shot, and where it looks at each frame. */
  shots: Shot[] = [];
  camera = new CameraTrack();
  /** Each figure's motion through the replay (its heading, stride and footfalls), measured once: by actor. */
  rig: RigTrack[] = [];

  /** The field with nobody moving: no play yet. */
  static rest(rest: Rest): PlayScript {
    const script = new PlayScript();
    for (let n = 1; n <= 9; n++) script.actors.push(new Actor("fielding", Ballpark.position(n), { kind: "fielder", n }, { crouch: n === 2 }));
    if (rest.bats) script.actors.push(new Actor("batting", Ballpark.box(rest.bats), { kind: "batter" }, { bats: rest.bats }));
    for (let base = 1; base <= 3; base++) if (rest.bases[base - 1]) script.actors.push(new Actor("batting", Ballpark.lead(base)));
    script.measureBodies();
    return script;
  }

  static play(scene: PlayScene, rest: Rest): PlayScript {
    const b = new Builder(scene);
    switch (scene.kind.type) {
      case "strikeout":
        b.strikeout();
        break;
      case "walk":
      case "hitByPitch":
        b.walk();
        break;
      case "stolenBase":
      case "caughtStealing":
      case "pickoff":
      case "wildPitch":
      case "passedBall":
      case "balk":
      case "indifference":
        b.runnersPlay();
        break;
      default:
        if (scene.inPlay) b.ballInPlay();
        else b.runnersPlay();
    }
    b.finish();
    b.settleField(rest);
    b.headline();
    b.measureStamp();
    shoot(b);
    b.script.measureBodies();
    return b.script;
  }

  /**
   * Each figure's motion, measured once (`RigTrack`, an 8.5 ft figure), and
   * what each faces when he isn't running somewhere: a fielder the batter
   * until the ball's in play, then the ball until the play is over; the
   * catcher his pitcher; the batter the plate; a runner the mound; anyone
   * with the ball coming to him or leaving his hand, it.
   */
  measureBodies(): void {
    const contact = this.batted != null ? (this.flights[this.batted]?.start ?? null) : null;
    const settle = this.settle;
    this.rig = this.actors.map((actor) =>
      RigTrack.measure(0, this.duration, 8.5, (t) => actor.position(t), (t): RigFacing => {
        const a = actor.actions.find((a) => t > a.at - (a.kind === "throwBall" ? 0.5 : 0.45) && t < a.at + 0.2);
        if (a) return { point: a.toward };
        const role = actor.role;
        switch (role.kind) {
          case "fielder": {
            if (role.n === 2) return { point: Ballpark.rubber };
            const ball = contact != null && t > contact + 0.05 && t < settle ? this.ball(t) : null;
            return { point: ball ? ground(ball) : ORIGIN };
          }
          case "batter":
            return { point: ORIGIN };
          case "runner":
            return { point: Ballpark.rubber };
        }
      }),
    );
  }

  /** The ball at t: in flight, held where its last flight ended, or gone. */
  ball(t: number): FieldPoint | null {
    const first = this.flights[0];
    if (!first || !(t >= this.ballFrom) || !(t < this.ballGone + Actor.fade)) return null;
    let held = first.from;
    for (const flight of this.flights) {
      if (t < flight.start) return held;
      if (t <= flight.end) return flight.point(t);
      held = flight.to;
    }
    return held;
  }

  ballOpacity(t: number): number {
    return Number.isFinite(this.ballGone) ? 1 - Math.min(Math.max((t - this.ballGone) / Actor.fade, 0), 1) : 1;
  }
}

const suffix = <T>(items: readonly T[], n: number): T[] => (n <= 0 ? [] : items.slice(-n));

/** Assembles a script beat by beat. */
export class Builder {
  readonly scene: PlayScene;
  readonly script = new PlayScript();
  /** Actor index by the base a runner started from (0: the batter). */
  readonly runner = new Map<number, number>();
  readonly batter: number;
  readonly hand: Hand;
  /** The pitch leaves his hand after a 0.4 s delivery from the set, so the replay opens on the battery before anything flies. */
  readonly pitchStart = 0.5;
  /** When the pitch reaches the plate. */
  readonly contact: number;
  /** An extra-base hit's batter reaches his base no sooner than this. */
  gathered: number | null = null;

  constructor(scene: PlayScene) {
    this.scene = scene;
    this.hand = scene.bats ?? "R";
    // A 92 mph fastball reaches the plate in 0.42 s; slower pitches take longer.
    const mph = scene.pitch?.mph ?? 91;
    this.contact = this.pitchStart + Math.min(Math.max((0.42 * 92) / mph, 0.34), 0.62);
    for (let n = 1; n <= 9; n++) this.script.actors.push(new Actor("fielding", Ballpark.position(n), { kind: "fielder", n }, { crouch: n === 2 }));
    // On a runner's play the batter is still in the box.
    this.batter = this.script.actors.length;
    this.script.actors.push(new Actor("batting", Ballpark.box(this.hand), { kind: "batter" }, { bats: this.hand }));
    this.runner.set(0, this.batter);
    for (const r of scene.runners) {
      if (r.from <= 0) continue;
      this.runner.set(r.from, this.script.actors.length);
      this.script.actors.push(new Actor("batting", Ballpark.lead(r.from)));
    }
    // The pitch's type and speed, until the ball's in play: after that it's in the way.
    if (scene.pitch?.mph != null || scene.pitch?.code != null) this.script.label = { lower: this.pitchStart, upper: this.contact + 0.45 };
  }

  fielder(n: number): number {
    return Math.min(Math.max(n, 1), 9) - 1;
  }

  actor(index: number): Actor {
    return this.script.actors[index]!;
  }

  // MARK: Pitch

  /** Where the pitch crosses the plate: ESPN's pitch coordinates (zone x 91…141, y 148…192), spread out so a ball off the plate reads. */
  get plate(): FieldPoint {
    const x = ((this.scene.pitch?.x ?? 116) - 116) * 0.085;
    const z = 3.4 - ((this.scene.pitch?.y ?? 170) - 148) * 0.045;
    return { x: Math.min(Math.max(x, -6), 6), y: 0.5, z: Math.min(Math.max(z, 0.4), 5.5) };
  }

  /** The catcher's mitt, where the pitch was. */
  get mitt(): FieldPoint {
    const plate = this.plate;
    return { x: plate.x * 0.7, y: -6.5, z: Math.max(plate.z * 0.8, 1) };
  }

  /** Where the bat meets the ball, in front of the plate. */
  get contactPoint(): FieldPoint {
    return { x: this.hand === "L" ? 1.5 : -1.5, y: 2, z: 3 };
  }

  pitch(end: FieldPoint, time: number): void {
    this.script.release = this.pitchStart;
    this.script.flights.push(new Flight(this.pitchStart, time, { x: 0, y: 54, z: 6 }, end, { kind: "arc", peak: 0.6 }));
  }

  // MARK: Ball in play

  ballInPlay(): void {
    const { scene, script, contact } = this;
    const trajectory = scene.flight;
    let target = scene.spot ? Ballpark.feet(scene.spot) : this.guessSpot();
    const bearing = Ballpark.bearing(target);
    const degrees = (bearing * 180) / Math.PI;
    const fence = Ballpark.fence(bearing);
    const homeRun = scene.kind.type === "homeRun";
    if (homeRun) {
      // Over the fence, into the first rows.
      target = Ballpark.polar(Math.min(Math.max(scene.distance ?? 0, Ballpark.distance(target), fence + 24), fence + 60), degrees);
    } else if (Ballpark.distance(target) > fence - 7) {
      target = Ballpark.polar(fence - 7, degrees);
    }
    const distance = Ballpark.distance(target);
    let caught: boolean;
    switch (scene.kind.type) {
      case "flyOut":
      case "lineOut":
      case "popOut":
      case "foulOut":
      case "sacrificeFly":
        caught = true;
        break;
      case "doublePlay":
      case "triplePlay":
        caught = trajectory !== "ground";
        break;
      default:
        caught = false;
    }

    const contactPoint = this.contactPoint;
    this.pitch(contactPoint, contact);
    this.actor(this.batter).swing = contact;
    this.actor(this.batter).dropsBat = contact + 0.16;
    script.flashes.push({ beat: "contact", at: contact, point: contactPoint });

    // The flight, by ESPN's trajectory: a grounder hops and slows, a liner is
    // fast and flat, a fly hangs, a pop-up climbs.
    let time: number;
    let arc: Arc;
    let ease: Ease;
    switch (trajectory) {
      case "ground":
        time = Math.min(Math.max(distance / 125, 0.42), 1.25);
        arc = { kind: "bounce", hops: distance > 150 ? 4 : 3 };
        ease = "out";
        break;
      case "line":
        time = Math.min(Math.max(0.28 + distance / 260, 0.38), 1.05);
        arc = { kind: "arc", peak: 5 + distance * 0.045 };
        ease = "linear";
        break;
      case "fly":
        time = homeRun ? 1.75 : Math.min(Math.max(0.85 + distance / 300, 1.05), 1.85);
        arc = { kind: "arc", peak: homeRun ? 25 + distance * 0.13 : 22 + distance * 0.21 };
        ease = "linear";
        break;
      case "popUp":
        time = Math.min(Math.max(1.15 + distance / 600, 1.2), 1.5);
        arc = { kind: "arc", peak: 95 + distance * 0.1 };
        ease = "linear";
        break;
    }
    const land = contact + time;
    const to = fieldPoint(target, caught ? 4.5 : 0);
    script.batted = script.flights.length;
    script.flights.push(new Flight(contact, land, contactPoint, to, arc, ease));

    const first = scene.fielders[0] ?? scene.error ?? Ballpark.nearest(target);
    // Everyone else leans toward the ball.
    for (let n = 1; n <= 9; n++) {
      if (n === first || n === 2) continue;
      const home = Ballpark.position(n);
      const dx = target.x - home.x;
      const dy = target.y - home.y;
      const d = Math.hypot(dx, dy);
      if (!(d > 1)) continue;
      const step = Math.min(d * 0.08, 9);
      this.actor(this.fielder(n)).move([{ x: home.x + (dx / d) * step, y: home.y + (dy / d) * step }], contact + 0.1, contact + 0.75, "out");
    }

    if (homeRun) {
      // The outfielder runs back to the track and watches it go.
      const track = Ballpark.polar(fence - 9, degrees);
      this.actor(this.fielder(Ballpark.nearest(track))).move([track], contact + 0.1, land - 0.3, "out");
      const over = contact + time * Math.min(Math.max((fence - 2) / Math.max(distance, 1), 0), 1);
      const p = script.flights[script.flights.length - 1]!.point(over);
      script.fence = { at: over, point: { x: p.x, y: p.y, z: Math.max(p.z, Ballpark.wallHeight + 4) } };
      script.landing = { point: target, mark: "homeRun", at: land };
      script.ballGone = land + 0.15;
      script.stamp = over + 0.05;
      // The trot: quicker than the game's, so the replay ends with him crossing the plate.
      this.runners(contact + 0.3, 140, new Map());
      return;
    }

    const f1 = this.fielder(first);
    let holder = target;
    let held = land;
    if (caught) {
      this.actor(f1).move([target], contact + 0.08, land, "out");
      this.actor(f1).act(trajectory === "line" ? "glove" : "catchHigh", land, ORIGIN);
      script.flashes.push({ beat: "catchBall", at: land, point: to });
      script.landing = { point: target, mark: "out", at: land };
    } else if (trajectory === "ground" && distance < 165) {
      // Fielded where ESPN marks it.
      this.actor(f1).move([target], contact + 0.05, land, "out");
      this.actor(f1).act("scoop", land, ORIGIN);
      script.landing = { point: target, mark: scene.runners.some(isOut) ? "out" : "hit", at: land };
    } else {
      // A hit falls in; the fielder gets to it a beat later.
      held = land + 0.3;
      this.actor(f1).move([target], contact + 0.1, held, "out");
      this.actor(f1).act("scoop", held, ORIGIN);
      script.landing = { point: target, mark: "hit", at: land };
    }

    const throwing = scene.text.includes("throwing error");
    if (scene.error != null && !throwing && scene.fielders.length <= 1) {
      // A fielding error: the ball gets away from him.
      const d = Math.max(Ballpark.distance(target), 1);
      const loose = { x: target.x + (target.x / d) * 18, y: target.y + (target.y / d) * 18 };
      script.flights.push(new Flight(held, held + 0.4, fieldPoint(target), fieldPoint(loose), { kind: "bounce", hops: 2 }, "out"));
      this.actor(f1).move([loose], held + 0.05, held + 0.65, "out");
      holder = loose;
      held += 0.65;
    } else if (throwing && scene.fielders.length <= 1) {
      // A throwing error: wide of first, and on into foul ground.
      this.actor(this.fielder(3)).move([Ballpark.bag(1)], contact + 0.1, held);
      this.throwBall(holder, Ballpark.bag(1), held + 0.16, { overshoot: true, by: first });
    }

    // The throws, to where the outs were made.
    const chain = this.throwChain(holder, first, held, scene.fielders.length === 0);
    holder = chain.holder;
    held = chain.at;

    if (scene.runners.every((r) => !isOut(r)) && scene.error == null) {
      if (distance >= 165) {
        // A hit to the outfield: the ball comes back in to the cutoff.
        const relay = target.x < 0 ? 6 : 4;
        const cutoff = Ballpark.polar(150, degrees * 0.8);
        this.actor(this.fielder(relay)).move([cutoff], contact + 0.2, held);
        this.throwBall(holder, cutoff, held + 0.25, { by: first, catcher: relay });
      } else if (scene.kind.type === "single") {
        // An infield single: the throw to first, a step late.
        const beat = contact + 0.16 + Ballpark.baseline / 95 + 0.12;
        const bag = Ballpark.bag(1);
        this.actor(this.fielder(3)).move([bag], contact + 0.1, contact + 0.6);
        this.throwBall(holder, bag, Math.max(beat - this.throwTime(holder, bag), held + 0.1), { by: first, catcher: 3 });
      }
    }
    // An extra-base hit: the batter pulls in just after the ball's gathered (the camera cuts to him as it is).
    const batterEnd = scene.batter?.end;
    if (!caught && scene.error == null && batterEnd?.kind === "base" && batterEnd.base >= 2 && !scene.runners.some(isOut)) {
      this.gathered = held + 0.5;
    }
    this.runners(caught ? land + 0.05 : contact + 0.12, 95, chain.outs);
    if (caught && scene.batter != null && isOut(scene.batter)) {
      // He jogs out of the box until the catch.
      this.actor(this.batter).move([{ x: 22, y: 22 }], contact + 0.15, land + 0.2, "linear");
      this.actor(this.batter).vanish = land + 0.25;
    }
  }

  /** A spot for a ball in play ESPN didn't place: where the fielder named stands. */
  guessSpot(): Point {
    const n = this.scene.fielders[0] ?? this.scene.error;
    if (n != null) return n === 2 ? { x: 0, y: 12 } : n === 1 ? { x: 0, y: 45 } : Ballpark.position(n);
    switch (this.scene.kind.type) {
      case "homeRun":
        return Ballpark.polar(410, 0);
      case "double":
      case "triple":
        return Ballpark.polar(300, -20);
      case "single":
        return Ballpark.polar(200, 10);
      default:
        return Ballpark.polar(150, 0);
    }
  }

  throwTime(from: Point, to: Point): number {
    return Math.min(Math.max(Math.hypot(to.x - from.x, to.y - from.y) / 175 + 0.08, 0.22), 0.85);
  }

  /** A throw, by and to fielders by scorer's number when they're known (the thrower's arm comes through; the receiver gloves it). */
  throwBall(from: Point, to: Point, start: number, options: { overshoot?: boolean; by?: number | null; catcher?: number | null } = {}): number {
    const overshoot = options.overshoot ?? false;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const time = this.throwTime(from, to);
    let end = fieldPoint(to, 4);
    if (overshoot && d > 1) end = { x: to.x + ((to.x - from.x) / d) * 28 + 6, y: to.y + ((to.y - from.y) / d) * 28, z: 0 };
    this.script.flights.push(new Flight(start, start + time * (overshoot ? 1.3 : 1), fieldPoint(from, 5), end, { kind: "arc", peak: 3 + d * 0.035 }));
    if (options.by != null) this.actor(this.fielder(options.by)).act("throwBall", start, to);
    if (options.catcher != null && !overshoot) this.actor(this.fielder(options.catcher)).act("glove", start + time, from);
    return start + time;
  }

  /**
   * The fielding chain after the first fielder: a throw to whoever covered
   * each base where an out was made, relays through the cutoff, and outs the
   * holder makes on foot (3U). Returns when each base's out was made, and
   * where the ball ended up.
   */
  throwChain(start: Point, first: number, time: number, inferred: boolean): { outs: Map<number, number>; holder: Point; at: number } {
    const { scene, script, contact } = this;
    // Outs at bases in the order they were made: the lead runner's first.
    const outBases = scene.runners
      .flatMap((r) => (r.end.kind === "out" && r.end.at != null && (r.end.at !== 0 || r.from > 0) ? [r.end.at] : []))
      .sort((a, b) => (b === 0 ? 4 : b) - (a === 0 ? 4 : a));
    const receivers = inferred ? [] : scene.fielders.slice(1);
    let steps: { receiver: number | null; base: number | null }[];
    if (receivers.length >= outBases.length) {
      const relays = receivers.length - outBases.length;
      const tail = suffix(receivers, outBases.length);
      steps = [...receivers.slice(0, relays).map((r) => ({ receiver: r, base: null })), ...tail.map((r, i) => ({ receiver: r, base: outBases[i]! }))];
    } else {
      const missing = outBases.length - receivers.length;
      const tail = suffix(outBases, receivers.length);
      steps = [...outBases.slice(0, missing).map((b) => ({ receiver: null, base: b })), ...receivers.map((r, i) => ({ receiver: r, base: tail[i]! }))];
    }
    let holder = start;
    let number = first;
    let held = time + 0.16;
    const outs = new Map<number, number>();
    let wild = scene.error != null && !inferred && scene.text.includes("throwing error");
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const base = step.base;
      if (base == null) {
        // A relay: the cutoff man lines up between the ball and the next base.
        const r = step.receiver;
        if (r == null) continue;
        const next = steps.slice(i + 1).find((s) => s.base != null)?.base ?? 2;
        const bag = Ballpark.bag(next);
        const cutoff = { x: holder.x + (bag.x - holder.x) * 0.45, y: holder.y + (bag.y - holder.y) * 0.45 };
        this.actor(this.fielder(r)).move([cutoff], contact + 0.15, held);
        const arrive = this.throwBall(holder, cutoff, held, { by: number, catcher: r });
        holder = cutoff;
        number = r;
        held = arrive + 0.1;
        continue;
      }
      const bag = Ballpark.bag(base);
      const near = Math.hypot(bag.x - holder.x, bag.y - holder.y) < 32;
      const receiver = step.receiver ?? (near ? null : coverer(base, number));
      const last = i === steps.length - 1;
      if (receiver != null && receiver !== number) {
        this.actor(this.fielder(receiver)).move([bag], contact + 0.1, Math.max(contact + 0.7, held - 0.05));
        const arrive = this.throwBall(holder, bag, held, { overshoot: wild && last, by: number, catcher: receiver });
        if (wild && last) {
          wild = false;
          continue;
        }
        outs.set(base, arrive);
        script.flashes.push({ beat: "out", at: arrive, point: fieldPoint(Ballpark.base(base)) });
        holder = bag;
        number = receiver;
        held = arrive + 0.1;
      } else {
        // He takes it there himself.
        const d = Math.hypot(bag.x - holder.x, bag.y - holder.y);
        const arrive = held + Math.max(d / 70, 0.2);
        this.actor(this.fielder(number)).move([bag], held - 0.1, arrive, "out");
        script.flights.push(new Flight(held - 0.1, arrive, fieldPoint(holder, 4), fieldPoint(bag, 4), { kind: "straight" }, "out"));
        outs.set(base, arrive);
        script.flashes.push({ beat: "out", at: arrive, point: fieldPoint(Ballpark.base(base)) });
        holder = bag;
        held = arrive + 0.1;
      }
    }
    return { outs, holder, at: held };
  }

  /** Along the bases from one to another (4: home). */
  basePath(from: number, to: number): Point[] {
    const out: Point[] = [];
    for (let b = from + 1; b <= to; b++) out.push(Ballpark.base(b));
    return out;
  }

  /** Every runner to where the scorer put him: at `pace` ft/s, or, when he's out, a step behind the ball. */
  runners(start: number, pace: number, outs: ReadonlyMap<number, number>): void {
    const { scene, script } = this;
    for (const r of scene.runners) {
      const index = this.runner.get(r.from);
      if (index == null) continue;
      const actor = this.actor(index);
      const leave = r.from === 0 ? start + 0.04 : start;
      const end = r.end;
      if (end.kind === "base") {
        if (!(end.base > r.from)) continue;
        const b = end.base;
        const arrive = Math.max(leave + ((b - r.from) * Ballpark.baseline) / pace, r.from === 0 ? (this.gathered ?? 0) : 0);
        actor.move(this.basePath(r.from, b), leave, arrive);
        // A steal, and a triple's last few strides: feet first.
        if (scene.kind.type === "stolenBase" || (r.from === 0 && b === 3)) actor.slide = arrive - 0.26;
      } else if (end.kind === "scored") {
        const home = leave + ((4 - r.from) * Ballpark.baseline) / pace;
        actor.move(this.basePath(r.from, 4), leave, home);
        script.flashes.push({ beat: "run", at: home, point: { x: 0, y: 0, z: 0 } });
        actor.vanish = home + 0.15;
      } else {
        // The batter's own out at the plate (a strikeout), or at the catch: not a run.
        const at = end.at;
        if (at == null || (r.from === 0 && at === 0)) continue;
        const target = at === 0 ? 4 : at;
        if (target <= r.from) {
          // Doubled off or picked off: back toward his own base, too late.
          const when = outs.get(at) ?? leave + 0.6;
          actor.move([Ballpark.base(r.from)], leave, when + 0.08);
          actor.vanish = when + 0.35;
        } else {
          const when = outs.get(at) ?? leave + ((target - r.from) * Ballpark.baseline) / pace;
          // A step short when the ball arrives.
          const arrive = Math.max(when + 0.1, leave + 0.35);
          actor.move(this.basePath(r.from, target), leave, arrive);
          actor.vanish = arrive + 0.25;
          // A close play at second, third or home: he slides into the tag.
          if (target >= 2) actor.slide = Math.max(arrive - 0.26, leave + 0.1);
        }
      }
    }
  }

  // MARK: Strikeout, walk, runners

  strikeout(): void {
    const { script, contact } = this;
    const mitt = this.mitt;
    this.pitch(mitt, contact + 0.05);
    this.actor(this.fielder(2)).act("glove", contact + 0.05, Ballpark.rubber);
    const k = this.scene.kind;
    if (k.type === "strikeout" && !k.looking) this.actor(this.batter).swing = contact - 0.03;
    // Strike three pops the mitt.
    script.flashes.push({ beat: "catchBall", at: contact + 0.05, point: mitt });
    script.flashes.push({ beat: "out", at: contact + 0.08, point: fieldPoint(Ballpark.box(this.hand)) });
    script.stamp = contact + 0.14;
    this.actor(this.batter).vanish = contact + 0.75;
    // A runner going on the pitch: strike him out, throw him out.
    const chain = this.throwChain(ground(mitt), 2, contact + 0.05, true);
    this.runners(this.pitchStart - 0.1, 80, chain.outs);
  }

  walk(): void {
    const { script, contact } = this;
    if (this.scene.kind.type === "hitByPitch") {
      const at = fieldPoint(Ballpark.box(this.hand), 3);
      this.pitch(at, contact - 0.02);
      script.flights.push(new Flight(contact - 0.02, contact + 0.35, at, { x: at.x * 0.4, y: 9, z: 0 }, { kind: "bounce", hops: 2 }, "out"));
      script.flashes.push({ beat: "hitBatter", at: contact - 0.02, point: at });
    } else {
      this.pitch(this.mitt, contact + 0.05);
      this.actor(this.fielder(2)).act("glove", contact + 0.05, Ballpark.rubber);
    }
    this.actor(this.batter).dropsBat = contact + 0.22;
    script.stamp = contact + 0.3;
    // A jog to first; the runners forced along with him.
    this.runners(contact + 0.3, 62, new Map());
  }

  /** A steal, a pickoff, a wild pitch: the runners' play. */
  runnersPlay(): void {
    const { scene, script, contact } = this;
    const type = scene.kind.type;
    const pitched = type !== "pickoff" && type !== "balk";
    let holder = ground(this.mitt);
    let holding = 2;
    let held = contact + 0.05;
    if (!pitched) {
      holder = Ballpark.position(1);
      holding = 1;
      held = 0.45;
      script.flights.push(new Flight(0, 0.3, fieldPoint(holder, 5), fieldPoint(holder, 5), { kind: "straight" }));
    } else if (type === "wildPitch" || type === "passedBall") {
      // In the dirt, past the catcher, to the backstop.
      const plate = this.plate;
      const short = { x: plate.x, y: -4, z: 0.6 };
      const backstop = { x: plate.x >= 0 ? 16 : -16, y: -34 };
      this.pitch(short, contact + 0.05);
      script.flights.push(new Flight(contact + 0.05, contact + 0.75, short, fieldPoint(backstop), { kind: "bounce", hops: 2 }, "out"));
      this.actor(this.fielder(2)).move([{ x: backstop.x * 0.8, y: -28 }], contact + 0.15, contact + 0.85, "out");
      holder = backstop;
      held = contact + 0.9;
    } else {
      this.pitch(this.mitt, contact + 0.05);
      this.actor(this.fielder(2)).act("glove", contact + 0.05, Ballpark.rubber);
    }
    const thrown = type === "caughtStealing" || type === "pickoff" || scene.runners.some(isOut);
    const chain = thrown ? this.throwChain(holder, holding, held, scene.fielders.length === 0) : { outs: new Map<number, number>(), holder, at: held };
    // Stealing, they go with the pitch.
    const leave = !pitched ? 0.5 : type === "stolenBase" || type === "caughtStealing" ? this.pitchStart - 0.05 : contact + 0.1;
    this.runners(leave, 85, chain.outs);
    if (type === "stolenBase") {
      const r = scene.runners.find((x) => x.from > 0);
      if (r && r.end.kind === "base" && r.end.base > r.from) {
        // The throw, a beat behind him.
        const b = r.end.base;
        const bag = Ballpark.bag(b);
        this.actor(this.fielder(coverer(b, 2))).move([bag], contact, contact + 0.6);
        const safe = leave + ((b - r.from) * Ballpark.baseline) / 85 + 0.12;
        this.throwBall(holder, bag, Math.max(safe - this.throwTime(holder, bag), held + 0.1), { by: holding, catcher: coverer(b, 2) });
      }
    }
  }

  // MARK: End and settle

  /** The stamp lands as the play resolves (the last out, the batter reaching his base); the action ends when the last thing stops. */
  finish(): void {
    const { script } = this;
    script.flights.sort((a, b) => a.start - b.start);
    const outTimes = script.flashes.filter((f) => f.beat === "out").map((f) => f.at);
    const lastOut = outTimes.length > 0 ? Math.max(...outTimes) : null;
    const batterMoves = this.actor(this.batter).moves;
    const reached = batterMoves.length > 0 ? batterMoves[batterMoves.length - 1]!.end : null;
    if (!Number.isFinite(script.stamp)) {
      script.stamp = lastOut ?? Math.max(reached ?? 0, script.landing?.at ?? this.contact + 0.3);
    }
    const flightEnd = script.flights.length > 0 ? Math.max(...script.flights.map((f) => f.end)) : 0;
    const flashEnd = script.flashes.length > 0 ? Math.max(...script.flashes.map((f) => f.at)) : 0;
    const moveEnds = script.actors.flatMap((a) => a.moves.map((m) => m.end));
    const ends = [script.stamp + 0.4, flightEnd, flashEnd + 0.45, moveEnds.length > 0 ? Math.max(...moveEnds) : 0];
    script.settle = Math.max(Math.max(...ends), 1.2) + 0.75;
    script.ballGone = Math.min(script.ballGone, script.settle);
    script.puffs = script.flights.flatMap((flight) => flight.bounces.map((b) => ({ at: b.at, point: b.point })));
  }

  /**
   * The banner for a marquee play, landing with its payoff: off the bat for
   * a home run, the batter reaching his base for a double or a triple, the
   * last out of a double play, strike three. A single, a walk and a routine
   * out keep to the stamp.
   */
  headline(): void {
    const { scene, script, contact } = this;
    const moves = this.actor(this.batter).moves;
    const reached = (base: number): number | null => {
      const target = Ballpark.base(base);
      const move = moves.find((m) => {
        const last = m.path[m.path.length - 1];
        return last != null && samePoint(last, target);
      });
      return move ? move.end : null;
    };
    const banner = (text: string, tone: Banner["tone"], at: number, confetti = false) => {
      script.banner = { text, tone, at, until: Math.max(script.settle, at + 1.2), confetti };
    };
    if (scene.walkOff) {
      const runs = script.flashes.filter((f) => f.beat === "run").map((f) => f.at);
      const run = runs.length > 0 ? Math.max(...runs) : null;
      banner("WALK-OFF", "gold", scene.kind.type === "homeRun" ? contact + 0.3 : (run ?? script.stamp), true);
      return;
    }
    switch (scene.kind.type) {
      case "homeRun": {
        const slam = scene.runs === 4;
        banner(slam ? "GRAND SLAM" : "HOME RUN", slam ? "gold" : "hit", contact + 0.3, true);
        break;
      }
      case "triple":
        banner("TRIPLE", "hit", reached(3) ?? script.stamp, true);
        break;
      case "double":
        banner("DOUBLE", "hit", reached(2) ?? script.stamp);
        break;
      case "doublePlay":
        banner("DOUBLE PLAY", "out", script.stamp);
        break;
      case "triplePlay":
        banner("TRIPLE PLAY", "out", script.stamp);
        break;
      case "strikeout":
        banner("STRIKEOUT", "strikeout", script.stamp);
        break;
      default:
        break;
    }
  }

  /**
   * The scorer's mark's corner, measured from its type: the code at a fifth
   * of the view's height, the title under it at about a eighteenth, in a
   * view twice as wide as tall.
   */
  measureStamp(): void {
    const { scene, script } = this;
    const notation = scene.notation;
    if (notation.code === "") return;
    let code = 0;
    for (const part of notation.code.split(" ").filter((p) => p !== "")) {
      const bold = /\d/.test(part) || STAMP_MARKS.has(part);
      let width = 0;
      for (const c of part) width += /\d/.test(c) ? 0.6 : c === "-" ? 0.5 : 0.68;
      code += width * (bold ? 1 : 0.5) + 0.25;
    }
    if (scene.runs > 0) code += 1.15;
    // The title is at most about a third of the view (it steps down when longer).
    const title = Math.min((scene.title.length + (scene.kind.type === "homeRun" && scene.distance != null ? 9 : 0)) * 0.72 * 0.28, 3.4);
    const width = 0.055 + Math.max(code, title) * 0.2;
    script.corner = { width: width / CameraFrame.aspect + 0.03, height: 0.3 };
  }

  /**
   * After the hold: fielders walk back, runners take their leads, the next
   * batter steps in. At the end of a half-inning the teams change sides
   * instead.
   */
  settleField(rest: Rest): void {
    const { scene, script } = this;
    const s = script.settle;
    const back = s + 0.8;
    if (rest.swapped) {
      for (const actor of script.actors) actor.vanish = Math.min(actor.vanish, s);
      // The team that batted takes the field.
      for (let n = 1; n <= 9; n++) {
        script.actors.push(new Actor("batting", Ballpark.position(n), { kind: "fielder", n }, { appear: s + 0.15, crouch: n === 2 }));
      }
      for (let base = 1; base <= 3; base++) {
        if (rest.bases[base - 1]) script.actors.push(new Actor("fielding", Ballpark.lead(base), { kind: "runner" }, { appear: s + 0.4 }));
      }
      if (rest.bats) script.actors.push(new Actor("fielding", Ballpark.box(rest.bats), { kind: "batter" }, { appear: s + 0.4, bats: rest.bats }));
    } else {
      for (let n = 1; n <= 9; n++) this.actor(this.fielder(n)).move([Ballpark.position(n)], s, back);
      // A runner stays where the live bases have one; anyone else leaves.
      const covered = new Set<number>();
      for (const r of scene.runners) {
        const index = this.runner.get(r.from);
        if (index == null || r.end.kind !== "base") continue;
        const b = r.end.base;
        const actor = this.actor(index);
        if (rest.bases[b - 1] && !covered.has(b)) {
          covered.add(b);
          actor.move([Ballpark.lead(b)], s, back);
        } else {
          actor.vanish = Math.min(actor.vanish, s);
        }
      }
      for (let base = 1; base <= 3; base++) {
        if (rest.bases[base - 1] && !covered.has(base)) script.actors.push(new Actor("batting", Ballpark.lead(base), { kind: "runner" }, { appear: s + 0.2 }));
      }
      if (scene.batter == null) {
        // A runner's play: the batter is still up.
        if (rest.bats == null) this.actor(this.batter).vanish = Math.min(this.actor(this.batter).vanish, s);
      } else if (rest.bats) {
        script.actors.push(new Actor("batting", Ballpark.box(rest.bats), { kind: "batter" }, { appear: s + 0.3, bats: rest.bats }));
      }
    }
    script.duration = back + Actor.fade;
  }
}

/** Marks drawn bold in the stamp even without a number. */
export const STAMP_MARKS: ReadonlySet<string> = new Set(["HR", "BB", "HBP", "IBB", "SB", "WP", "PB", "BK", "DI", "K"]);
