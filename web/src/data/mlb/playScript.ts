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
 * When Statcast measured the play, the ball flies for real: the pitch along
 * its tracked path from the hand to where it crossed the plate, and the ball
 * off the bat from its exit velocity and launch angle, under gravity, drag
 * and lift, coming down where MLB measured it (`BattedFlight`). Its flight
 * keeps one pace from contact to glove (real speeds, a little quicker: near
 * real time for a grounder, about 2.5× for a high fly), and the fielders,
 * throws and runners key off when it really gets there. Without Statcast the
 * flight is drawn from ESPN's trajectory class, as before.
 *
 * Where MLB's official account has been found for the play (`PlayScene.official`,
 * `handling`), it's told from that: the ball to the man credited with
 * fielding it (on through the infield to an outfielder), the throws along the
 * credited chain to each putout in order, errors and deflections as credited,
 * every runner on his real path; then, once the ball's been handled, each run
 * crossing in turn and the batter taking his base. Without it, ESPN's text
 * and inference, as before.
 *
 *     const script = PlayScript.play(scene, { bases: scene.basesAfter, bats: "R", swapped: scene.endsInning });
 *     script.ball(1.2); script.camera.frame(1.2);
 */
import { CameraFrame, CameraTrack, shoot, TROT_CUT, type Shot } from "./playCamera";
import { coverer, isOut, type Effort, type Hand, type Handling, type PlayScene, type Runner } from "./playScene";
import { seedOf, type Hurt } from "./playBeat";
import { pitchPosition, plateTime, type StatcastPitch } from "./statcast";
import { Ballpark, distanceBetween, easeValue, fieldPoint, ground, ORIGIN, samePoint, type Ease, type FieldPoint, type Point } from "./theaterField";
import { ballMemo, RigTrack, type RigFacing } from "../theater/rig";
import { bridgePlan, TheaterBridge, type BridgeFigure, type BridgePlan } from "../theater/theaterBridge";

/** The teams, and the umpires (who wear neither). */
export type Team = "fielding" | "batting" | "official";

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
  | { readonly kind: "runner" }
  /** A manager, a coach or a trainer, out of the dugout. */
  | { readonly kind: "coach" }
  /** The plate umpire. */
  | { readonly kind: "umpire" };

/**
 * An umpire's call, as he makes it: a called strike's punch (a strikeout
 * looking's punch-out, side-on), a swinging strike's point, both arms up for
 * a foul, safe and out at the plate, a tap on the cap for a challenge.
 */
export interface Signal {
  readonly kind: "strike" | "punchOut" | "swinging" | "foul" | "safe" | "out" | "challenge";
  readonly at: number;
  /** Where he's looking as he makes it (the plate for a play there; else the pitcher). */
  readonly toward: Point;
}

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
  /**
   * At full stretch for the ball (a diving or leaping catch): from `start` his
   * glove goes to `target`, reaching it at `reach`; a dive ends on the grass at
   * `landing`. (The figures don't draw it yet: a lunge stands in.)
   */
  dive: { readonly start: number; readonly reach: number; readonly target: FieldPoint; readonly landing: Point } | null = null;
  /** The pitcher's throwing hand (a lefty's delivery is mirrored), and his arm slot: 0 sidearm, 1 over the top. */
  arm: Hand | null = null;
  slot = 0.7;
  /** A check swing (the bat starts through and holds up), and a bunt squared from here on. */
  check: number | null = null;
  bunt: number | null = null;
  /** In his set: the pitcher in the stretch, the umpire in his crouch behind the catcher. */
  sets: { readonly lower: number; readonly upper: number }[] = [];
  /** The pitcher leaning in for the sign; the catcher up out of his crouch. */
  sign: { readonly lower: number; readonly upper: number } | null = null;
  rise: { readonly lower: number; readonly upper: number }[] = [];
  /** Head first back into a base (a throw over), from this moment. */
  diveBack: number | null = null;
  /** A practice swing, half speed, from this moment. */
  practice: number | null = null;
  /** An umpire's calls, each from its moment. */
  signals: Signal[] = [];
  /** ESPN's athlete ID when the play names him (the batter, each runner): who the tag over him says he is. */
  athlete: string | null = null;

  constructor(team: Team, at: Point, role: Role = { kind: "runner" }, options: { crouch?: boolean; bats?: Hand | null; appear?: number; athlete?: string | null } = {}) {
    this.team = team;
    this.at = at;
    this.role = role;
    this.crouch = options.crouch ?? false;
    this.bats = options.bats ?? null;
    if (options.appear != null) this.appear = options.appear;
    this.athlete = options.athlete ?? null;
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
  | { readonly kind: "arc"; readonly peak: number }
  /** A tracked pitch: Statcast's path between two of its moments (seconds from its release), in real time. */
  | { readonly kind: "pitch"; readonly pitch: StatcastPitch; readonly from: number; readonly to: number }
  /** A measured batted ball: its flight sampled evenly in time. */
  | { readonly kind: "samples"; readonly points: readonly FieldPoint[] };

export class Flight {
  constructor(
    readonly start: number,
    readonly end: number,
    readonly from: FieldPoint,
    readonly to: FieldPoint,
    readonly arc: Arc,
    readonly ease: Ease = "linear",
    /** A measured flight's touchdowns, as fractions of it: the dust puffs. */
    readonly hops: readonly number[] = [],
  ) {}

  /** Another ball (a warm-up throw after the last one came in): unseen until it's thrown. */
  fresh = false;

  point(t: number): FieldPoint {
    const raw = this.end > this.start ? Math.min(Math.max((t - this.start) / (this.end - this.start), 0), 1) : 1;
    if (this.arc.kind === "pitch") return pitchPoint(this.arc.pitch, this.arc.from + (this.arc.to - this.arc.from) * raw);
    if (this.arc.kind === "samples" && this.arc.points.length > 1) {
      const points = this.arc.points;
      const i = raw * (points.length - 1);
      const lower = Math.min(Math.trunc(i), points.length - 2);
      const f = i - lower;
      const p = points[lower]!;
      const q = points[lower + 1]!;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f };
    }
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
      case "samples":
        break;
    }
    return { x, y, z };
  }

  /** When a bouncing ball touches down between hops, and where: the dust puffs. (Found once, by sampling: the ease has no inverse.) */
  get bounces(): { at: number; point: Point }[] {
    if (this.arc.kind === "samples") return this.hops.map((u) => ({ at: this.start + u * (this.end - this.start), point: ground(this.point(this.start + u * (this.end - this.start))) }));
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
  /** Above the field: a home run in the seats. */
  readonly z?: number;
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
  /** The fielding team is the home team (its dugout and bullpen are on the first-base side; the visitors' on the third). Absent: true. */
  readonly fieldingHome?: boolean;
  /** What still stands on the field between pitches: the trainer out to an injured man, the tarp in a rain delay. */
  readonly standing?: Standing | null;
}

export type Standing = { readonly kind: "injury"; readonly hurt: Hurt } | { readonly kind: "tarp" };

export const EMPTY_REST: Rest = { bases: [false, false, false], bats: null, swapped: false };

/** Where fielder `n` waits for the pitch: his position, the first baseman holding a runner on at the bag. */
export function restSpot(rest: Pick<Rest, "bases">, n: number): Point {
  if (n === 3 && rest.bases[0]) return Ballpark.holding;
  return Ballpark.position(n);
}

/** Where an injured man is down: by the plate, on the mound, or (MLB says only who) on the infield grass. */
export function hurtSpot(hurt: Hurt): Point {
  return hurt === "batter" ? { x: -5, y: 4 } : hurt === "pitcher" ? { x: 0, y: 55 } : { x: 18, y: 70 };
}

/** What the status tag says as a beat plays: each from its moment (a pitch's call as it pops the mitt, a challenge and how it came out). */
export interface Caption {
  readonly at: number;
  readonly line: import("./playBeat").CaptionLine;
}

/** The infield tarp: rolled out (or in) from `at` over `TARP_ROLL`. */
export interface Tarp {
  readonly at: number;
  readonly out: boolean;
}

export const TARP_ROLL = 2.4;

/** How much of the infield the tarp covers at t (0…1). */
export function tarpCover(tarp: Tarp, t: number): number {
  const u = easeValue("inOut", (t - tarp.at) / TARP_ROLL);
  return tarp.out ? u : 1 - u;
}

/** The strike zone at the front of the plate while a pitch is on its way (this batter's, as MLB measured it), and where the ball crossed it. */
export interface Zone {
  readonly bottom: number;
  readonly top: number;
  /** When it crosses the plate, and where: feet across, and height. */
  readonly at: number;
  readonly crossing: Point;
  /** Shown from, and fading from. */
  readonly from: number;
  readonly until: number;
}

/** Half the plate's width, and its front (feet from its point). */
export const ZONE_HALF = 17 / 24;
export const ZONE_FRONT = 17 / 12;

export class PlayScript {
  actors: Actor[] = [];
  flights: Flight[] = [];
  flashes: Flash[] = [];
  captions: Caption[] = [];
  zone: Zone | null = null;
  /** A flight the fielders turn to watch (a foul ball) when nothing was put in play. */
  watch: number | null = null;
  tarp: Tarp | null = null;
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
    if (rest.standing?.kind === "tarp") {
      // A rain delay: the field's empty under the tarp.
      script.tarp = { at: -TARP_ROLL, out: true };
      return script;
    }
    for (let n = 1; n <= 9; n++) script.actors.push(new Actor("fielding", restSpot(rest, n), { kind: "fielder", n }, { crouch: n === 2 }));
    if (rest.bats) script.actors.push(new Actor("batting", Ballpark.box(rest.bats), { kind: "batter" }, { bats: rest.bats }));
    for (let base = 1; base <= 3; base++) if (rest.bases[base - 1]) script.actors.push(new Actor("batting", Ballpark.lead(base)));
    if (rest.standing?.kind === "injury") {
      // The trainer and the manager, out with him.
      const spot = hurtSpot(rest.standing.hurt);
      const team: Team = rest.standing.hurt === "batter" ? "batting" : "fielding";
      script.actors.push(new Actor(team, { x: spot.x + 4, y: spot.y - 2 }, { kind: "coach" }));
      script.actors.push(new Actor(team, { x: spot.x - 4, y: spot.y + 1 }, { kind: "coach" }));
    }
    // The plate umpire, last: every other figure keeps its place.
    script.actors.push(new Actor("official", Ballpark.umpire(rest.bats), { kind: "umpire" }));
    script.measureBodies();
    return script;
  }

  /**
   * Everyone as the hand-off from the field between pitches matches them
   * (theaterBridge.ts): by team, by role (each fielder his own position, the
   * batter, the runners, the umpire, a coach), the same man by his athlete;
   * where each is at t.
   */
  bridgeFigures(t: number): BridgeFigure[] {
    return this.actors.map((a) => {
      const group = a.team === "batting" ? 0 : a.team === "fielding" ? 1 : 2;
      const kind = a.role.kind === "fielder" ? `f${a.role.n}` : a.role.kind;
      return { group, kind, athlete: a.athlete, at: a.position(t) };
    });
  }

  /** Its own lead-in: the still moment before anyone (or the ball) moves, which a hand-off from the field between pitches uses first. */
  get leadIn(): number {
    let first = Infinity;
    for (const a of this.actors) if (a.moves[0]) first = Math.min(first, a.moves[0].start);
    for (const f of this.flights) if (!f.fresh) first = Math.min(first, f.start);
    return Math.max(Number.isFinite(first) ? first : 0.5, 0);
  }

  /**
   * How the field between pitches on screen (`this` at `t`: the routine
   * between pitches, an idle move or still) meets what comes in now (`next`:
   * a pitch's beat, a play's replay) (PlayTheater.bridge): each figure from
   * where he is to his place as it begins, unless it's another field (the
   * other half of the inning: `together` false), a man far out of place
   * (`TheaterBridge.far.baseball`), or Reduce Motion: then a crossfade.
   * (pure; tested)
   */
  bridge(t: number, next: PlayScript, together: boolean, reduceMotion: boolean, beatLeft: number | null = null): BridgePlan {
    return bridgePlan(this.bridgeFigures(t), next.bridgeFigures(0), { room: next.leadIn, far: TheaterBridge.far.baseball, together, reduceMotion, beatLeft });
  }

  /** The plate umpire's index (the last of the figures there at the start). */
  get umpire(): number | null {
    for (let i = this.actors.length - 1; i >= 0; i--) if (this.actors[i]!.role.kind === "umpire") return i;
    return null;
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
    b.umpireCalls();
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
    const traced = this.batted ?? this.watch;
    const contact = traced != null ? (this.flights[traced]?.start ?? null) : null;
    const settle = this.settle;
    const ball = ballMemo(this);
    this.rig = this.actors.map((actor) =>
      RigTrack.measure(0, this.duration, 8.5, (t) => actor.position(t), (t): RigFacing => {
        const a = actor.actions.find((a) => t > a.at - (a.kind === "throwBall" ? 0.5 : 0.45) && t < a.at + 0.2);
        if (a) return { point: a.toward };
        const role = actor.role;
        switch (role.kind) {
          case "fielder": {
            if (role.n === 2) return { point: Ballpark.rubber };
            const b = contact != null && t > contact + 0.05 && t < settle ? ball(t) : null;
            return { point: b ? ground(b) : ORIGIN };
          }
          case "batter":
            return { point: ORIGIN };
          case "runner":
          case "coach":
            return { point: Ballpark.rubber };
          case "umpire": {
            // His call to where it's made; the ball while it's in play; else the pitcher.
            const call = actor.signals.find((c) => t > c.at - 0.45 && t < c.at + 1.0);
            if (call) return { point: call.toward };
            const b = contact != null && t > contact + 0.05 && t < settle ? ball(t) : null;
            return { point: b ? ground(b) : Ballpark.rubber };
          }
        }
      }),
    );
  }

  /** The ball at t: in flight, held where its last flight ended, or gone. */
  ball(t: number): FieldPoint | null {
    const first = this.flights[0];
    if (!first || !(t >= this.ballFrom) || !(t < this.ballGone + Actor.fade)) return null;
    let held = first.from;
    for (const [i, flight] of this.flights.entries()) {
      if (t < flight.start) return flight.fresh && i > 0 ? null : held;
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
  /** The plate umpire. */
  readonly umpire: number;
  readonly hand: Hand;
  /** The pitch leaves his hand after a 0.4 s delivery from the set, so the replay opens on the battery before anything flies. */
  readonly pitchStart = 0.5;
  /** When the pitch reaches the plate. */
  readonly contact: number;
  /** The pitch as Statcast tracked it: its path, and when (seconds from its fit's start) it left the hand and crossed the front of the plate. */
  readonly tracked: { readonly pitch: StatcastPitch; readonly release: number; readonly plate: number } | null;
  /** An extra-base hit's batter reaches his base no sooner than this. */
  gathered: number | null = null;
  /** Who handled the ball, as MLB's official scorer credited it (null: infer it). */
  readonly handling: Handling | null;
  /** Each run as it crosses the plate: the runner, and when. */
  crossings: { readonly actor: number; readonly at: number }[] = [];
  /** When a throw got away (a runner waiting on it goes on). */
  loose: number | null = null;

  constructor(played: PlayScene) {
    // MLB's official account of the runners, where it has one.
    const scene = played.official;
    this.scene = scene;
    this.handling = scene.handling;
    this.hand = scene.bats ?? "R";
    const p = scene.measured?.pitch;
    const plate = p ? plateTime(p) : null;
    const release = p ? pitchTimeAt(p, Ballpark.release) : null;
    if (p && plate != null && release != null && release < plate && p.plate[1] >= 0.3) {
      // Real time from the hand (a stride off the rubber) to the plate.
      this.tracked = { pitch: p, release, plate };
      this.contact = this.pitchStart + plate - release;
    } else {
      this.tracked = null;
      // A 92 mph fastball reaches the plate in 0.42 s; slower pitches take longer.
      const mph = scene.pitch?.mph ?? 91;
      this.contact = this.pitchStart + Math.min(Math.max((0.42 * 92) / mph, 0.34), 0.62);
    }
    // Where they waited for the pitch (the first baseman holding a runner on).
    const waiting = { bases: scene.basesBefore };
    for (let n = 1; n <= 9; n++) this.script.actors.push(new Actor("fielding", restSpot(waiting, n), { kind: "fielder", n }, { crouch: n === 2 }));
    // On a runner's play the batter is still in the box.
    this.batter = this.script.actors.length;
    this.script.actors.push(new Actor("batting", Ballpark.box(this.hand), { kind: "batter" }, { bats: this.hand, athlete: scene.batter?.id }));
    this.runner.set(0, this.batter);
    for (const r of scene.runners) {
      if (r.from <= 0) continue;
      this.runner.set(r.from, this.script.actors.length);
      this.script.actors.push(new Actor("batting", Ballpark.lead(r.from), { kind: "runner" }, { athlete: r.id }));
    }
    this.umpire = this.script.actors.length;
    this.script.actors.push(new Actor("official", Ballpark.umpire(this.hand), { kind: "umpire" }));
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

  /**
   * Where the pitch crosses the plate: Statcast's measurement, else ESPN's
   * pitch coordinates (zone x 91…141, y 148…192), spread out so a ball off
   * the plate reads.
   */
  get plate(): FieldPoint {
    if (this.tracked) return pitchPoint(this.tracked.pitch, this.tracked.plate);
    const x = ((this.scene.pitch?.x ?? 116) - 116) * 0.085;
    const z = 3.4 - ((this.scene.pitch?.y ?? 170) - 148) * 0.045;
    return { x: Math.min(Math.max(x, -6), 6), y: 0.5, z: Math.min(Math.max(z, 0.4), 5.5) };
  }

  /** When a tracked pitch reaches the catcher's mitt, on past the plate (or where he picks it out of the dirt). */
  get mittTime(): number | null {
    const tracked = this.tracked;
    const at = tracked ? pitchTimeAt(tracked.pitch, -6.5) : null;
    if (!tracked || at == null) return null;
    return Math.min(at, pitchTimeAtHeight(tracked.pitch, 0.3, tracked.plate) ?? at);
  }

  /** The catcher's mitt, where the pitch was. */
  get mitt(): FieldPoint {
    const at = this.mittTime;
    if (this.tracked && at != null) return pitchPoint(this.tracked.pitch, at);
    const plate = this.plate;
    return { x: plate.x * 0.7, y: -6.5, z: Math.max(plate.z * 0.8, 1) };
  }

  /** Where the bat meets the ball: where the pitch crossed the plate when it's tracked, else in front of the plate. */
  get contactPoint(): FieldPoint {
    return this.tracked == null ? { x: this.hand === "L" ? 1.5 : -1.5, y: 2, z: 3 } : this.plate;
  }

  pitch(end: FieldPoint, time: number): void {
    this.script.release = this.pitchStart;
    this.script.flights.push(new Flight(this.pitchStart, time, { x: 0, y: Ballpark.release, z: 6 }, end, { kind: "arc", peak: 0.6 }));
  }

  /** The tracked pitch, from the hand to the plate (and on into the catcher's mitt when he catches it): Statcast's path in real time. */
  trackedPitch(intoMitt: boolean): void {
    const tracked = this.tracked;
    if (!tracked) return;
    const end = intoMitt ? (this.mittTime ?? tracked.plate) : tracked.plate;
    this.script.release = this.pitchStart;
    this.script.flights.push(
      new Flight(this.pitchStart, this.contact + end - tracked.plate, pitchPoint(tracked.pitch, tracked.release), pitchPoint(tracked.pitch, end), {
        kind: "pitch",
        pitch: tracked.pitch,
        from: tracked.release,
        to: end,
      }),
    );
  }

  // MARK: Ball in play

  ballInPlay(): void {
    const { scene, script, contact, handling } = this;
    const trajectory = scene.flight;
    let target = scene.spot ? Ballpark.feet(scene.spot) : this.guessSpot();
    // Marked at the plate, though a fielder out in the field took it (an upstream glitch): where he plays.
    if (this.atThePlate(target)) target = this.guessSpot();
    // A ground ball an outfielder fielded, marked where it got through the infield: on to him.
    const through = this.through(target);
    if (through) target = through;
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
    // Measured: the real flight, ending where it's caught, fielded or lands in the seats.
    const real = this.battedFlight(target, caught);
    const realEnd = real?.points[real.points.length - 1];
    if (realEnd) target = ground(realEnd);
    const bearing = Ballpark.bearing(target);
    const degrees = (bearing * 180) / Math.PI;
    const fence = Ballpark.fence(bearing);
    const homeRun = scene.kind.type === "homeRun";
    if (real == null && homeRun) {
      // Over the fence, into the first rows.
      target = Ballpark.polar(Math.min(Math.max(scene.distance ?? 0, Ballpark.distance(target), fence + 24), fence + 60), degrees);
    } else if (real == null && Ballpark.distance(target) > fence - 7) {
      target = Ballpark.polar(fence - 7, degrees);
    }
    const distance = Ballpark.distance(target);

    const contactPoint = this.contactPoint;
    if (this.tracked) this.trackedPitch(false);
    else this.pitch(contactPoint, contact);
    this.actor(this.batter).swing = contact;
    this.actor(this.batter).dropsBat = contact + 0.16;
    script.flashes.push({ beat: "contact", at: contact, point: contactPoint });

    // `land`: in the glove (caught or fielded on the ground), into the seats,
    // or a hit's first bounce; `reached`: a measured hit getting to its
    // fielder; `over`: a home run clearing the fence.
    let land: number;
    let to: FieldPoint;
    let reached: number | null = null;
    let over: number | null = null;
    script.batted = script.flights.length;
    if (real) {
      // One pace from contact to glove: its speeds and slowing real, a little quicker.
      const end = contact + real.duration * Builder.pace(real.duration);
      const replay = (seconds: number) => contact + (seconds / Math.max(real.duration, 0.01)) * (end - contact);
      to = realEnd ?? fieldPoint(target);
      script.flights.push(
        new Flight(contact, end, real.points[0] ?? contactPoint, to, { kind: "samples", points: real.points }, "linear", real.hops.map((h) => h / Math.max(real.duration, 0.01))),
      );
      land = caught || homeRun || (trajectory === "ground" && distance < 165) ? end : replay(real.touchdown);
      reached = end;
      over = real.over != null ? replay(real.over) : null;
    } else {
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
      land = contact + time;
      to = fieldPoint(target, caught ? (scene.effort === "diving" ? 1.2 : 4.5) : 0);
      script.flights.push(new Flight(contact, land, contactPoint, to, arc, ease));
      if (homeRun) over = contact + time * Math.min(Math.max((fence - 2) / Math.max(distance, 1), 0), 1);
    }

    const first = handling?.fielder ?? scene.fielders[0] ?? scene.error ?? Ballpark.nearest(target);
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
    if (through || handling?.deflection != null) this.reachForIt(first);

    if (homeRun) {
      // The outfielder runs back to the track and watches it go.
      const track = Ballpark.polar(fence - 9, degrees);
      this.actor(this.fielder(Ballpark.nearest(track))).move([track], contact + 0.1, land - 0.3, "out");
      const cleared = over ?? land;
      const p = script.flights[script.flights.length - 1]!.point(cleared);
      script.fence = { at: cleared, point: { x: p.x, y: p.y, z: Math.max(p.z, Ballpark.wallHeight + 4) } };
      script.landing = { point: target, mark: "homeRun", at: land, z: to.z };
      script.ballGone = land + 0.15;
      script.stamp = cleared + 0.05;
      // The trot: quicker than the game's, so the replay ends with him crossing the plate.
      this.runners(contact + 0.3, 140, new Map());
      this.sequenceTrot(cleared + TROT_CUT, 140);
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
      // A hit falls in; the fielder gets to it a beat later (a measured one where it hops to him,
      // one through the infield as it gets to him).
      held = reached ?? land + (through == null ? 0.3 : 0);
      this.actor(f1).move([target], contact + 0.1, held, "out");
      this.actor(f1).act("scoop", held, ORIGIN);
      script.landing = { point: target, mark: "hit", at: reached ?? land };
    }
    if (scene.effort) this.stretch(f1, scene.effort, to, caught ? land : held);

    const throwing = scene.text.includes("throwing error");
    // MLB's credits say who booted it, and every throw (one that got away too); else ESPN's text.
    if (handling?.fumble != null || (handling == null && scene.error != null && !throwing && scene.fielders.length <= 1)) {
      // A fielding error: the ball gets away from him.
      const d = Math.max(Ballpark.distance(target), 1);
      const loose = { x: target.x + (target.x / d) * 18, y: target.y + (target.y / d) * 18 };
      script.flights.push(new Flight(held, held + 0.4, fieldPoint(target), fieldPoint(loose), { kind: "bounce", hops: 2 }, "out"));
      this.actor(f1).move([loose], held + 0.05, held + 0.65, "out");
      holder = loose;
      held += 0.65;
    } else if (handling == null && throwing && scene.fielders.length <= 1) {
      // A throwing error: wide of first, and on into foul ground.
      this.actor(this.fielder(3)).move([Ballpark.bag(1)], contact + 0.1, held);
      this.throwBall(holder, Ballpark.bag(1), held + 0.16, { overshoot: true, by: first });
    }

    // The throws, to where the outs were made.
    const chain = this.throwChain(holder, first, held, scene.fielders.length === 0);
    holder = chain.holder;
    held = chain.at;

    if (scene.runners.every((r) => !isOut(r)) && scene.error == null && (handling == null || handling.chain.length === 0)) {
      if (distance >= 165) {
        // A hit to the outfield: the ball comes back in to the cutoff.
        // (Not the man who went out for it.)
        const relay = first === 6 ? 4 : first === 4 ? 6 : target.x < 0 ? 6 : 4;
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
    // The rest of the story in order: the runs once the ball's been handled, then the batter's base.
    const outTimes = [...chain.outs.values()];
    const lastOut = outTimes.length > 0 ? Math.max(...outTimes) : null;
    this.sequenceRuns(Math.max(chain.at, lastOut ?? 0), 95, scene.outsAfter >= 3 ? lastOut : null);
  }

  /**
   * Replay seconds a second of a measured flight takes: one pace for the
   * whole flight, near real time for a grounder, quicker the longer it hangs
   * (a 5 s fly plays in about 2).
   */
  static pace(seconds: number): number {
    return Math.min(0.82 * Math.max(seconds, 0.05) ** -0.42, 1);
  }

  /**
   * The batted ball's real flight, when Statcast measured its launch: toward
   * its spot, coming down at its measured distance (within this park's
   * walls: a home run clears them, anything else stays in).
   */
  battedFlight(espnSpot: Point, caught: boolean): BattedFlight | null {
    const batted = this.scene.measured?.batted;
    const speed = batted?.launchSpeed;
    const angle = batted?.launchAngle;
    if (!batted || speed == null || angle == null) return null;
    let spot = batted.spot ? Ballpark.feet({ x: batted.spot[0], y: batted.spot[1] }) : espnSpot;
    if (this.atThePlate(spot)) spot = espnSpot;
    spot = this.through(spot) ?? spot;
    const degrees = (Ballpark.bearing(spot) * 180) / Math.PI;
    const fence = Ballpark.fence(Ballpark.bearing(spot));
    const measured = batted.distance != null ? Ballpark.polar(batted.distance, degrees) : null;
    if (this.scene.kind.type === "homeRun") {
      const landing = Ballpark.polar(Math.max(batted.distance ?? this.scene.distance ?? 0, fence + 18), degrees);
      return new BattedFlight(speed, angle, this.contactPoint, landing, { kind: "homeRun" });
    }
    if (caught) {
      const at = Ballpark.polar(Math.min(batted.distance ?? Ballpark.distance(spot), fence - 7), degrees);
      return new BattedFlight(speed, angle, this.contactPoint, at, { kind: "caught", height: 4.5 });
    }
    if (Ballpark.distance(spot) > fence - 7) spot = Ballpark.polar(fence - 7, degrees);
    return new BattedFlight(speed, angle, this.contactPoint, measured, { kind: "fielded", spot });
  }

  /** A spot for a ball in play ESPN didn't place: where the fielder named stands. */
  guessSpot(): Point {
    const n = this.handling?.fielder ?? this.scene.fielders[0] ?? this.scene.error;
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
    let steps: { receiver: number | null; base: number | null; wild: boolean }[];
    if (receivers.length >= outBases.length) {
      const relays = receivers.length - outBases.length;
      const tail = suffix(receivers, outBases.length);
      steps = [...receivers.slice(0, relays).map((r) => ({ receiver: r, base: null, wild: false })), ...tail.map((r, i) => ({ receiver: r, base: outBases[i]!, wild: false }))];
    } else {
      const missing = outBases.length - receivers.length;
      const tail = suffix(outBases, receivers.length);
      steps = [...outBases.slice(0, missing).map((b) => ({ receiver: null, base: b, wild: false })), ...receivers.map((r, i) => ({ receiver: r, base: tail[i]!, wild: false }))];
    }
    const lastStep = steps[steps.length - 1];
    if (scene.error != null && !inferred && scene.text.includes("throwing error") && lastStep) lastStep.wild = true;
    // MLB's credits name every throw: to whom, where, in the order of the outs, and the one that got away.
    if (this.handling) steps = this.handling.chain.map((t) => ({ receiver: t.to, base: t.base, wild: t.wild }));
    let holder = start;
    let number = first;
    let held = time + 0.16;
    const outs = new Map<number, number>();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const base = step.base;
      if (base == null) {
        // A relay: the cutoff man lines up between the ball and the next base.
        const r = step.receiver;
        if (r == null) continue;
        const next = steps.slice(i + 1).find((s) => s.base != null)?.base ?? 2;
        const bag = Ballpark.bag(next);
        let cutoff = { x: holder.x + (bag.x - holder.x) * 0.45, y: holder.y + (bag.y - holder.y) * 0.45 };
        // A runner caught between bases (no ball in play): each man in the rundown takes it at his own
        // bag, or chasing him off it toward the last one.
        const own = RUNDOWN_BAGS[r];
        if (!scene.inPlay && own != null) {
          const a = Ballpark.bag(own);
          const b = Ballpark.bag(own === next ? own - 1 : own);
          cutoff = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
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
      if (receiver != null && receiver !== number) {
        this.actor(this.fielder(receiver)).move([bag], contact + 0.1, Math.max(contact + 0.7, held - 0.05));
        const arrive = this.throwBall(holder, bag, held, { overshoot: step.wild, by: number, catcher: receiver });
        if (step.wild) {
          // Past him: whoever was waiting on it goes on.
          this.loose = arrive - 0.1;
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
        // (One who stays put has nowhere to go, unless a throw gets past.)
        if (end.base > r.from) {
          const b = end.base;
          const arrive = Math.max(leave + ((b - r.from) * Ballpark.baseline) / pace, r.from === 0 ? (this.gathered ?? 0) : 0);
          actor.move(this.basePath(r.from, b), leave, arrive);
          // A steal, and a triple's last few strides: feet first.
          if (scene.kind.type === "stolenBase" || (r.from === 0 && b === 3)) actor.slide = arrive - 0.26;
        }
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
      if (r.waits != null && this.loose != null) this.onTheThrow(r, index, r.waits, this.loose, leave, pace);
    }
  }

  // MARK: Strikeout, walk, runners

  /** When the pitch pops the catcher's mitt. */
  get pop(): number {
    const tracked = this.tracked;
    return tracked ? this.contact + (this.mittTime ?? tracked.plate) - tracked.plate : this.contact + 0.05;
  }

  /** The pitch, all the way into the catcher's mitt. */
  pitchToMitt(): void {
    if (this.tracked) this.trackedPitch(true);
    else this.pitch(this.mitt, this.pop);
  }

  strikeout(): void {
    const { script, contact, pop } = this;
    const mitt = this.mitt;
    this.pitchToMitt();
    this.actor(this.fielder(2)).act("glove", pop, Ballpark.rubber);
    const k = this.scene.kind;
    if (k.type === "strikeout" && !k.looking) this.actor(this.batter).swing = contact - 0.03;
    // Strike three pops the mitt.
    script.flashes.push({ beat: "catchBall", at: pop, point: mitt });
    script.flashes.push({ beat: "out", at: pop + 0.03, point: fieldPoint(Ballpark.box(this.hand)) });
    script.stamp = pop + 0.09;
    this.actor(this.batter).vanish = contact + 0.75;
    // A runner going on the pitch: strike him out, throw him out.
    const chain = this.throwChain(ground(mitt), 2, pop, true);
    this.runners(this.pitchStart - 0.1, 80, chain.outs);
    this.droppedThirdStrike(chain.outs);
  }

  walk(): void {
    const { script, contact } = this;
    if (this.scene.kind.type === "hitByPitch") {
      const at = fieldPoint(Ballpark.box(this.hand), 3);
      this.pitch(at, contact - 0.02);
      script.flights.push(new Flight(contact - 0.02, contact + 0.35, at, { x: at.x * 0.4, y: 9, z: 0 }, { kind: "bounce", hops: 2 }, "out"));
      script.flashes.push({ beat: "hitBatter", at: contact - 0.02, point: at });
    } else {
      this.pitchToMitt();
      this.actor(this.fielder(2)).act("glove", this.pop, Ballpark.rubber);
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
    // (A runner caught stealing on a pickoff: the pitcher's throw, as MLB credits it or the text says.)
    const pitched = type !== "pickoff" && type !== "balk" && this.handling?.fielder !== 1 && !scene.text.includes("picked off");
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
      // (The runner who stole: with first and third on, the man on third may stay put.)
      const r = scene.runners.find((x) => x.from > 0 && x.end.kind === "base" && x.end.base > x.from);
      if (r && r.end.kind === "base" && r.end.base > r.from) {
        // The throw, a beat behind him; one that got away (the text's throwing error) went to the
        // base he stole, and he goes on from there as it's past.
        const b = r.end.base;
        const wild = b > r.from + 1 && scene.text.includes("throwing error");
        const stolen = wild ? r.from + 1 : b;
        const bag = Ballpark.bag(stolen);
        this.actor(this.fielder(coverer(stolen, 2))).move([bag], contact, contact + 0.6);
        const safe = leave + ((stolen - r.from) * Ballpark.baseline) / 85 + 0.12;
        const past = this.throwBall(holder, bag, Math.max(safe - this.throwTime(holder, bag), held + 0.1), { overshoot: wild, by: holding, catcher: coverer(stolen, 2) });
        const index = this.runner.get(r.from);
        if (wild && index != null) this.onTheThrow(r, index, stolen, past - 0.1, leave, 85);
      }
    }
  }

  // MARK: The umpire

  /**
   * The plate umpire through the play: in his set behind the catcher as the
   * pitch comes; strike three's call (the punch-out, looking); out from
   * behind the plate on a ball in play, watching it; and at the plate for a
   * play there, safe or out. A home run's trot and a run walked in aren't
   * plays at the plate.
   */
  umpireCalls(): void {
    const { scene, script } = this;
    const u = this.actor(this.umpire);
    if (script.release != null) u.sets.push({ lower: this.pitchStart - 0.45, upper: (scene.inPlay ? this.contact : this.pop) + 0.25 });
    if (scene.kind.type === "strikeout") u.signals.push({ kind: scene.kind.looking ? "punchOut" : "swinging", at: this.pop + (scene.kind.looking ? 0.08 : 0.1), toward: Ballpark.rubber });
    // Out from behind the catcher, up the third-base side, to watch it.
    if (scene.inPlay) u.move([{ x: -4.5, y: -5 }], this.contact + 0.2, this.contact + 0.75, "out");
    const type = scene.kind.type;
    if (type === "homeRun" || type === "walk" || type === "hitByPitch") return;
    const calls = script.flashes.filter((f) => (f.beat === "run" || f.beat === "out") && Math.hypot(f.point.x, f.point.y) < 3);
    if (calls.length === 0) return;
    const first = Math.min(...calls.map((c) => c.at));
    // Up the line to see it: the plate between him and the runner's path in.
    u.move([{ x: -7, y: -4 }], Math.max(first - 1.0, scene.inPlay ? this.contact + 0.3 : 0.2), first - 0.12, "out");
    for (const call of calls) u.signals.push({ kind: call.beat === "run" ? "safe" : "out", at: call.at + 0.05, toward: ORIGIN });
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
      // The runs on the mark land as the last one crosses.
      const run = this.crossings[this.crossings.length - 1]?.at;
      if (run != null) script.stamp = Math.max(script.stamp, run);
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
    // The title is at most about a third of the view (it steps down when longer); Statcast's line under it, about as wide.
    const readout = scene.readout;
    const title = Math.min((scene.title.length + (scene.kind.type === "homeRun" && scene.distance != null && readout == null ? 9 : 0)) * 0.72 * 0.28, 3.4);
    const numbers = readout != null ? Math.min(readout.length * 0.6 * 0.26, 4.4) : 0;
    const width = 0.055 + Math.max(code, title, numbers) * 0.2;
    script.corner = { width: width / CameraFrame.aspect + 0.03, height: readout == null ? 0.3 : 0.36 };
  }

  /**
   * After the hold: fielders walk back, runners take their leads, the next
   * batter steps in. At the end of a half-inning the teams change sides
   * instead.
   */
  settleField(rest: Rest): void {
    const { scene, script } = this;
    const s = script.settle;
    let back = s + 0.8;
    if (rest.swapped) {
      // The side that fielded jogs off to its dugout, the batters to theirs; the side that batted
      // comes out of its dugout and takes the field. A long way out (an outfielder's) is seen in
      // part: he's gone part way there, or comes into view part way out, at a jog.
      const home = rest.fieldingHome ?? true;
      const leaving = Ballpark.dugout(!home);
      const coming = Ballpark.dugout(home);
      const pace = 38;
      const stagger = (i: number) => Number(seedOf(`${scene.id}.${i}`) % 40n) / 100;
      script.actors.forEach((actor, i) => {
        if (!(actor.vanish > s) || actor.team === "official") return;
        const from = actor.position(s);
        const to = actor.team === "fielding" ? leaving : coming;
        const d = Math.max(Math.hypot(to.x - from.x, to.y - from.y), 1);
        const jog = Math.min(d / pace, 1.9);
        const start = s + stagger(i);
        const f = Math.min((jog * pace) / d, 1);
        actor.move([{ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f }], start, start + jog, "linear");
        actor.vanish = Math.min(actor.vanish, start + jog - Actor.fade);
      });
      let arrived = s;
      for (let n = 1; n <= 9; n++) {
        const spot = restSpot(rest, n);
        const d = Math.max(Math.hypot(spot.x - coming.x, spot.y - coming.y), 1);
        const jog = Math.min(d / pace, 2.1);
        const f = Math.max(1 - (jog * pace) / d, 0);
        const start = s + 0.6 + stagger(n + 20);
        const a = new Actor("batting", { x: coming.x + (spot.x - coming.x) * f, y: coming.y + (spot.y - coming.y) * f }, { kind: "fielder", n }, { appear: start - 0.1, crouch: n === 2 });
        a.move([spot], start, start + jog, "out");
        script.actors.push(a);
        arrived = Math.max(arrived, start + jog);
      }
      for (let base = 1; base <= 3; base++) {
        if (rest.bases[base - 1]) script.actors.push(new Actor("fielding", Ballpark.lead(base), { kind: "runner" }, { appear: arrived }));
      }
      if (rest.bats) script.actors.push(new Actor("fielding", Ballpark.box(rest.bats), { kind: "batter" }, { appear: arrived, bats: rest.bats }));
      back = arrived + 0.2;
      // The umpire stays: back behind the plate.
      this.actor(this.umpire).move([Ballpark.umpire(rest.bats)], s, s + 1.2);
    } else {
      for (let n = 1; n <= 9; n++) this.actor(this.fielder(n)).move([restSpot(rest, n)], s, back);
      this.actor(this.umpire).move([Ballpark.umpire(rest.bats)], s, back);
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

  // MARK: The official account, told in order

  /**
   * A ground ball an outfielder fielded (MLB's credit, else ESPN's text),
   * marked short of the outfield grass: that's where it got through the
   * infield, not where he picked it up. On along its line to where he meets
   * it, charging in from where he plays. Null for anything else.
   */
  through(spot: Point): Point | null {
    const n = this.handling?.fielder ?? this.scene.fielders[0];
    if (this.scene.flight !== "ground" || n == null || n < 7 || n > 9) return null;
    if (!(Math.hypot(spot.x - Ballpark.rubber.x, spot.y - Ballpark.rubber.y) < Ballpark.skin + 5)) return null;
    const d = Math.max(Ballpark.distance(spot), 1);
    const u = { x: spot.x / d, y: spot.y / d };
    const home = Ballpark.position(n);
    // Level with him on its line, less the ground he makes up charging it.
    const meet = Math.max(home.x * u.x + home.y * u.y - 50, d + 40);
    return { x: u.x * meet, y: u.y * meet };
  }

  /** A spot at the plate for a ball someone out in the field took (not the pitcher or the catcher): a glitch upstream (ESPN's and MLB's alike). */
  atThePlate(spot: Point): boolean {
    const n = this.handling?.fielder ?? this.scene.fielders[0];
    return n != null && Ballpark.distance(spot) < 12 && n > 2;
  }

  /**
   * A ground ball through the infield: the infielders it gets between reach
   * for it as it goes by, and miss; the one MLB credits with a deflection gets
   * a glove on it. (How far each goes is inferred: MLB says only who fielded
   * it, and who it glanced off.)
   */
  reachForIt(first: number): void {
    const index = this.script.batted;
    if (index == null) return;
    const flight = this.script.flights[index]!;
    for (const n of [1, 3, 4, 5, 6]) {
      if (n === first) continue;
      const home = Ballpark.position(n);
      // Where and when it passes nearest him, low enough to reach.
      let near = { at: flight.end, d: Infinity, p: ORIGIN };
      for (let k = 0; k <= 80; k++) {
        const t = flight.start + ((flight.end - flight.start) * k) / 80;
        const p = flight.point(t);
        const d = Math.hypot(p.x - home.x, p.y - home.y);
        if (p.z < 6 && d < near.d) near = { at: t, d, p: ground(p) };
      }
      // As far as he can get before it's by (about 28 ft a second), and near enough to try.
      const glances = n === this.handling?.deflection;
      const steps = Math.max(near.at - this.contact - 0.1, 0) * 28;
      if (!(glances || (near.d < 32 && near.d - steps < 10))) continue;
      // A few quick steps (all the way, for the man it glances off), the glove down as it goes by.
      const reach = glances ? 1 : Math.min(Math.max(1 - 6 / Math.max(near.d, 1), 0), 0.8, steps / Math.max(near.d, 1));
      const spot = { x: home.x + (near.p.x - home.x) * reach, y: home.y + (near.p.y - home.y) * reach };
      this.actor(this.fielder(n)).move([spot], this.contact + 0.06, near.at, "out");
      this.actor(this.fielder(n)).act("scoop", near.at, near.p);
    }
  }

  /**
   * A catch the scorer's text calls diving or leaping: his last strides at
   * full stretch, the glove to the ball low on the grass or up over his head
   * (`Actor.dive`, for the figures to draw; until they do, a lunge stands in
   * for a dive).
   */
  stretch(index: number, effort: Effort, ball: FieldPoint, time: number): void {
    const actor = this.actor(index);
    const from = actor.position(time - 0.3);
    const d = Math.hypot(ball.x - from.x, ball.y - from.y);
    const diving = effort === "diving";
    const landing = diving && d > 1 ? { x: ball.x + ((ball.x - from.x) / d) * 4, y: ball.y + ((ball.y - from.y) / d) * 4 } : ground(ball);
    const glove = fieldPoint(ground(ball), diving ? Math.min(ball.z, 1.5) : Math.max(ball.z, 8.5));
    actor.dive = { start: time - 0.3, reach: time, target: glove, landing };
    if (!diving) return;
    actor.actions = actor.actions.filter((a) => !(Math.abs(a.at - time) < 0.01));
    actor.act("scoop", time, ground(ball));
    actor.move([landing], time, time + 0.3, "out");
  }

  /**
   * The rest of the play in the order a replay tells it: once the ball's been
   * handled (fielded, thrown, the outs made), each run crosses the plate, the
   * lead runner first, a beat apart; then the batter takes his extra base.
   * Runners leave as the play has them; one who'd be home sooner (off screen,
   * while the camera's on the ball) is held at third first. A run beats a
   * third out, though: after one it wouldn't count.
   */
  sequenceRuns(told: number, pace: number, third: number | null): void {
    const { scene } = this;
    let last = -Infinity;
    let clear = -Infinity;
    for (const r of scene.runners.filter((x) => x.end.kind === "scored").sort((a, b) => b.from - a.from)) {
      const index = this.runner.get(r.from);
      const moves = index != null ? this.actor(index).moves : [];
      const leave = moves[0]?.start;
      const natural = moves[moves.length - 1]?.end;
      if (index == null || leave == null || natural == null) continue;
      const cross = third == null ? Math.max(natural, told + 0.55, last + 0.6) : natural;
      if (cross > natural + 0.01) {
        // Held at third, unless the man ahead is still there when he'd get to it.
        const atThird = leave + ((3 - Math.min(r.from, 3)) * Ballpark.baseline) / pace;
        this.holdThenRun(index, r.from, atThird > clear + 0.1 ? 3 : 2, cross, natural, pace);
      }
      this.crossings.push({ actor: index, at: cross });
      last = cross;
      clear = cross - Ballpark.baseline / pace;
    }
    // The batter into second or third once they're in, while he's still running it.
    const end = scene.batter?.end;
    const lastRun = this.crossings[this.crossings.length - 1]?.at;
    const moves = this.actor(this.batter).moves;
    const move = moves[moves.length - 1];
    const finish = move?.path[move.path.length - 1];
    if (lastRun == null || end?.kind !== "base" || end.base < 2 || scene.batter?.waits != null || !move || !finish) return;
    if (!samePoint(finish, Ballpark.base(end.base)) || !(move.end < lastRun + 0.45)) return;
    const arrive = lastRun + 0.45;
    if (!((end.base * Ballpark.baseline) / (arrive - move.start) >= 50)) return;
    const batter = this.actor(this.batter);
    batter.move(this.basePath(0, end.base), move.start, arrive);
    if (batter.slide != null) batter.slide = arrive - 0.26;
  }

  /**
   * A home run's trot as the replay tells it: the runners watch it go, then
   * come in ahead of the batter, a beat apart, once the camera has cut to the
   * trot (so it sees every run cross); the batter last.
   */
  sequenceTrot(cut: number, pace: number): void {
    let last = -Infinity;
    const order = this.scene.runners
      .filter((r) => r.end.kind === "scored")
      .sort((a, b) => (a.from === 0 ? (b.from === 0 ? 0 : 1) : b.from === 0 ? -1 : b.from - a.from));
    order.forEach((r, k) => {
      const index = this.runner.get(r.from);
      const moves = index != null ? this.actor(index).moves : [];
      const move = moves[moves.length - 1];
      if (index == null || !move) return;
      const natural = move.end;
      const cross = Math.max(natural, cut + 0.1 + 0.4 * k, last + 0.4);
      if (cross > natural + 0.01) {
        if (r.from === 0) {
          // The batter: the same trot, a little slower.
          this.actor(index).move(this.basePath(0, 4), move.start, cross);
          this.retime(index, natural, cross);
        } else {
          this.holdThenRun(index, r.from, null, cross, natural, pace);
        }
      }
      this.crossings.push({ actor: index, at: cross });
      last = cross;
    });
  }

  /**
   * A runner who scores later than his pace would have him. On a ball in
   * play he runs on as far as `hold` (third, or second while the man ahead is
   * still on third) and is held there until he must go (from his own base, a
   * couple of shuffles off it first); on a home run (`hold` null) he watches
   * it from his base, then trots. Either way he crosses at `arrive`, and the
   * plate's pop moves with him.
   */
  holdThenRun(index: number, base: number, hold: number | null, arrive: number, natural: number, pace: number): void {
    const actor = this.actor(index);
    const leave = actor.moves[0]?.start;
    if (leave == null) return;
    const at = actor.at;
    const stop = Math.max(hold ?? base, base);
    const reach = leave + ((stop - base) * Ballpark.baseline) / pace;
    const go = Math.max(arrive - ((4 - stop) * Ballpark.baseline) / pace, reach);
    actor.moves = [];
    if (stop > base) {
      actor.move(this.basePath(base, stop), leave, reach);
    } else if (hold != null && go > leave + 0.3) {
      const next = Ballpark.base(base + 1);
      const d = Math.hypot(next.x - at.x, next.y - at.y);
      if (d > 12) actor.move([{ x: at.x + ((next.x - at.x) / d) * 8, y: at.y + ((next.y - at.y) / d) * 8 }], leave, Math.min(leave + 0.5, go), "out");
    }
    actor.move(this.basePath(stop, 4), go, arrive);
    this.retime(index, natural, arrive);
  }

  /**
   * Strike three that got away from the catcher (MLB credits his throw to
   * first): the batter drops the bat and runs for it once the pitch is by,
   * out a step behind the throw (or safe at first, when he beat it).
   */
  droppedThirdStrike(outs: ReadonlyMap<number, number>): void {
    const r = this.scene.batter;
    if (!r) return;
    let base: number;
    if (r.end.kind === "out" && r.end.at != null && r.end.at > 0) base = r.end.at;
    else if (r.end.kind === "base" && r.end.base > 0) base = r.end.base;
    else return;
    const { pop } = this;
    const arrive = Math.max((outs.get(base) ?? pop + 1.0) + 0.1, pop + 0.7);
    const batter = this.actor(this.batter);
    batter.moves = [];
    batter.move(this.basePath(0, base), pop + 0.12, arrive);
    batter.dropsBat = pop + 0.12;
    batter.vanish = isOut(r) ? arrive + 0.25 : Infinity;
    // Not out at the plate after all.
    const box = Ballpark.box(this.hand);
    this.script.flashes = this.script.flashes.filter((f) => !(f.beat === "out" && samePoint(ground(f.point), box)));
  }

  /** A run's moment moved: the plate's pop, and when he's gone. */
  retime(index: number, natural: number, cross: number): void {
    const flashes = this.script.flashes;
    const i = flashes.findIndex((f) => f.beat === "run" && Math.abs(f.at - natural) < 0.001);
    if (i >= 0) flashes[i] = { ...flashes[i]!, at: cross };
    this.actor(index).vanish = cross + 0.15;
  }

  /**
   * MLB's account of a runner who took his last base on a throw that got
   * away (or went elsewhere): he gets to the base before it, waits, and goes
   * on as the ball gets past.
   */
  onTheThrow(r: Runner, index: number, waits: number, loose: number, leave: number, pace: number): void {
    let end: number;
    if (r.end.kind === "base") end = r.end.base;
    else if (r.end.kind === "scored") end = 4;
    else return;
    if (!((waits > r.from || r.from === 0) && waits < end)) return;
    const reach = leave + ((waits - r.from) * Ballpark.baseline) / pace;
    const go = Math.max(loose, reach + 0.1);
    const arrive = go + ((end - waits) * Ballpark.baseline) / pace;
    const actor = this.actor(index);
    const natural = actor.moves[actor.moves.length - 1]?.end ?? arrive;
    actor.moves = [];
    actor.move(this.basePath(r.from, waits), leave, reach);
    actor.move(this.basePath(waits, end), go, arrive);
    if (end === 4) this.retime(index, natural, arrive);
    if (actor.slide != null) actor.slide = arrive - 0.26;
  }
}

/** In a rundown, the bag each infielder takes it at (0: home). */
const RUNDOWN_BAGS: Readonly<Record<number, number>> = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 2 };

/** Marks drawn bold in the stamp even without a number. */
export const STAMP_MARKS: ReadonlySet<string> = new Set(["HR", "BB", "HBP", "IBB", "SB", "WP", "PB", "BK", "DI", "K"]);

// MARK: - Measured flights

/** Where a tracked pitch is in the field's frame, which is Statcast's own: feet from the plate's point, x toward first base (the catcher's right), y out toward the mound, z up. */
export function pitchPoint(p: StatcastPitch, t: number): FieldPoint {
  const [x, y, z] = pitchPosition(p, t);
  return { x, y, z };
}

/** When it's `y` feet from the plate's point on its way in: before its fit's start for the hand (Statcast starts it at 50 ft), past the plate for the mitt. */
export function pitchTimeAt(p: StatcastPitch, y: number): number | null {
  const a = p.acceleration[1] / 2;
  const b = p.velocity[1];
  const c = p.release[1] - y;
  if (a === 0) return b === 0 ? null : -c / b;
  const d = b * b - 4 * a * c;
  if (d < 0) return null;
  return [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)].find((t) => p.velocity[1] + p.acceleration[1] * t < 0) ?? null;
}

/** When it first drops to `height` feet after `t` (a pitch in the dirt), if it does. */
export function pitchTimeAtHeight(p: StatcastPitch, height: number, after: number): number | null {
  const a = p.acceleration[2] / 2;
  const b = p.velocity[2];
  const c = p.release[2] - height;
  const d = b * b - 4 * a * c;
  if (a === 0 || d < 0) return null;
  const roots = [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)].filter((t) => t > after);
  return roots.length > 0 ? Math.min(...roots) : null;
}

/** How a measured flight ends: in a glove this high (feet) where it comes down; on along the ground after it lands, to where it was fielded; over the fence and into the seats. */
export type BattedEnd = { readonly kind: "caught"; readonly height: number } | { readonly kind: "fielded"; readonly spot: Point } | { readonly kind: "homeRun" };

/** A moment of the flight in its own upright plane: feet along the ground and up, and their speeds (feet a second). */
interface FlightState {
  s: number;
  z: number;
  vs: number;
  vz: number;
}

/**
 * A batted ball's real flight, from Statcast's launch: off the bat at its
 * exit velocity and launch angle, toward its spot, under gravity, air drag
 * and the lift of its backspin. Each ball's drag is calibrated (by false
 * position, once, when the script is built) so it comes down where MLB
 * measured it: caught where it was caught; a hit, or a grounder's first hop,
 * landing at its distance and hopping on to its fielder; a drive off the
 * wall back to him; a home run into the seats. The lift is fixed (about a fly
 * ball's), so hang times come out real: a 105 mph fly at 28° carries 400 ft
 * in about 5 s, a liner is on its fielder in under 2, a pop-up hangs for 5.
 * Sampled every 1/120 s of the game's time; drawing reads the samples.
 */
export class BattedFlight {
  /** The game's seconds between samples. */
  static readonly step = 1 / 120;
  static readonly gravity = 32.174;
  /**
   * Drag, as k in a deceleration of k·v² (per foot): a baseball's is about
   * 0.0022 (what it meets once it's down). The calibration stays in this
   * range and stretches the path for whatever's left (nothing, for a real ball).
   */
  static readonly drag = { lower: 0.0004, upper: 0.006 };
  static readonly airDrag = 0.0022;
  /** Lift, as k·v² square to the flight: a fly ball's backspin (a lift coefficient near 0.16), fading out for a ball driven into the ground. */
  static lift(degrees: number): number {
    return 0.0009 * Math.min(Math.max(degrees / 15, 0), 1);
  }
  /**
   * Off the ground: how much of its vertical speed a hop keeps; the grip of a
   * bounce (pace lost in proportion to the vertical speed it turns round: a
   * chopper slows, a skipping liner hardly); a roll's friction (ft/s²).
   */
  static readonly restitution = 0.45;
  static readonly scuff = 0.35;
  static readonly friction = 3.0;

  /** The ball every `step` from contact. */
  readonly points: readonly FieldPoint[];
  /** Seconds from contact: when it first touches the grass (or is caught, or lands in the seats), and every touchdown, that one included. */
  readonly touchdown: number;
  readonly hops: readonly number[];
  /** A home run's moment over the fence. */
  readonly over: number | null;

  get duration(): number {
    return Math.max(this.points.length - 1, 0) * BattedFlight.step;
  }

  /**
   * `speed` (mph) and `angle` (degrees) off the bat at `contact`, coming down
   * at `landing` (caught there, a home run's spot on the field's level, a
   * hit's first bounce; null: wherever an average ball's drag brings it,
   * toward its spot).
   */
  constructor(speed: number, angle: number, contact: FieldPoint, landing: Point | null, end: BattedEnd) {
    const B = BattedFlight;
    const spot = end.kind === "fielded" ? end.spot : null;
    const aim = landing ?? spot ?? { x: 0, y: 200 };
    const reach = Math.max(Math.hypot(aim.x - contact.x, aim.y - contact.y), 1);
    const u = { x: (aim.x - contact.x) / reach, y: (aim.y - contact.y) / reach };
    const v0 = (speed * 5280) / 3600;
    const a = (Math.min(angle, 88) * Math.PI) / 180;
    const lift = B.lift(angle);
    const start: FlightState = { s: 0, z: Math.max(contact.z, 0.3), vs: v0 * Math.cos(a), vz: v0 * Math.sin(a) };
    const field = (s: number, z: number): FieldPoint => ({ x: contact.x + u.x * s, y: contact.y + u.y * s, z: Math.max(z, 0) });
    // This park's fence, in feet along the flight.
    const fence = Ballpark.fence(Ballpark.bearing(aim)) - (contact.x * u.x + contact.y * u.y);
    let floor = 0;
    if (end.kind === "caught") {
      // A liner caught at his shoetops comes down only that far.
      floor = Math.min(end.height, Math.max(start.z + Math.max(start.vz, 0) ** 2 / (2 * B.gravity) - 0.75, 0.3));
    }
    // Where it comes down: a home run far enough out to clear this park's
    // fence; a drive that would land past it hits the wall instead.
    let goal: number | null = landing == null ? null : reach;
    let offWall = false;
    if (end.kind === "homeRun") goal = Math.max(goal ?? 0, fence + 18);
    else if (end.kind === "fielded" && goal != null && goal > fence - 3) {
      offWall = true;
      goal = Math.min(goal, fence + 6);
    }
    let drag = B.airDrag;
    let stretch = 1;
    if (goal != null) {
      [drag, stretch] = B.calibrate(start, lift, floor, goal);
      // Over the wall's top, not through it.
      let clear = goal;
      while (end.kind === "homeRun" && clear < fence + 80 && B.height(start, drag, lift, fence / stretch) < Ballpark.wallHeight + 3) {
        clear += 8;
        [drag, stretch] = B.calibrate(start, lift, floor, clear);
      }
    }
    // Fielded before it came down: it ends at the glove.
    const spotAlong = spot ? Math.hypot(spot.x - contact.x, spot.y - contact.y) : null;
    const fieldedAt = spotAlong != null && !offWall && spotAlong < (goal ?? Infinity) - 2 ? spotAlong : null;
    const air = B.fly(start, drag, lift, floor, (offWall ? fence - 1 : (fieldedAt ?? Infinity)) / stretch, true);
    let points = air.path.map((p) => field(p.s * stretch, p.z));
    const hops: number[] = [];
    let over: number | null = null;

    if (end.kind === "homeRun") {
      // Over the fence, then down into the seats.
      const beyond = (p: FieldPoint) => Ballpark.distance(ground(p)) - Ballpark.fence(Ballpark.bearing(ground(p)));
      const cut = points.findIndex((p) => beyond(p) > 0 && p.z <= B.seats(beyond(p)));
      if (cut >= 0) {
        points = points.slice(0, cut + 1);
        points[cut] = { ...points[cut]!, z: B.seats(beyond(points[cut]!)) };
      }
      const i = points.findIndex((p) => beyond(p) >= 0);
      over = i >= 0 ? i * B.step : null;
    } else if (end.kind === "fielded" && (air.landed || offWall)) {
      let down = { ...air.end, s: air.end.s * stretch };
      if (!air.landed) {
        // Off the wall: back off it, and down.
        const carom = B.fly({ s: down.s, z: down.z, vs: -0.45 * down.vs, vz: 0.6 * down.vz }, drag, 0, 0, Infinity, true);
        points = [...points, ...carom.path.slice(1).map((p) => field(p.s, p.z))];
        down = carom.end;
      }
      hops.push((points.length - 1) * B.step);
      // On along the ground to the fielder.
      const at = ground(field(down.s, 0));
      const length = Math.hypot(end.spot.x - at.x, end.spot.y - at.y);
      if (length > 1) {
        const w = { x: (end.spot.x - at.x) / length, y: (end.spot.y - at.y) / length };
        const along = B.along(Math.abs(down.vs), Math.min(down.vz, 0), length);
        const first = points.length - 1;
        points = [...points, ...along.path.slice(1).map((p) => ({ x: at.x + w.x * p.s, y: at.y + w.y * p.s, z: p.z }))];
        hops.push(...along.hops.map((h) => (first + h) * B.step));
      }
    }
    this.points = points;
    this.touchdown = hops[0] ?? (points.length - 1) * B.step;
    this.hops = hops;
    this.over = over;
  }

  point(seconds: number): FieldPoint {
    const points = this.points;
    if (points.length <= 1) return points[0] ?? { x: 0, y: 0, z: 0 };
    const i = Math.min(Math.max(seconds / BattedFlight.step, 0), points.length - 1);
    const lower = Math.min(Math.trunc(i), points.length - 2);
    const f = i - lower;
    const p = points[lower]!;
    const q = points[lower + 1]!;
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f };
  }

  /** The seats' height this far past the fence (the stands the field draws). */
  static seats(beyond: number): number {
    return beyond < 6 ? Ballpark.wallHeight + beyond / 3 : Math.min(Ballpark.wallHeight + 2 + (beyond - 6) / 2, 44);
  }

  // MARK: Simulation

  /** One step (1/120 s), midpoint: gravity, drag against the flight, lift square to it. */
  static advance(p: FlightState, k: number, l: number): FlightState {
    const dt = BattedFlight.step;
    const g = BattedFlight.gravity;
    let v = Math.sqrt(p.vs * p.vs + p.vz * p.vz);
    const ms = p.vs + ((-k * v * p.vs - l * v * p.vz) * dt) / 2;
    const mz = p.vz + ((-g - k * v * p.vz + l * v * p.vs) * dt) / 2;
    v = Math.sqrt(ms * ms + mz * mz);
    return { s: p.s + ms * dt, z: p.z + mz * dt, vs: p.vs + (-k * v * ms - l * v * mz) * dt, vz: p.vz + (-g - k * v * mz + l * v * ms) * dt };
  }

  /** Part of the way from one moment to the next. */
  static between(p: FlightState, q: FlightState, f: number): FlightState {
    return { s: p.s + (q.s - p.s) * f, z: p.z + (q.z - p.z) * f, vs: p.vs + (q.vs - p.vs) * f, vz: p.vz + (q.vz - p.vz) * f };
  }

  /**
   * Through the air until it comes down through `floor`, reaches `limit`
   * feet along, or 12 s pass: every step on the way when `record`ed, where
   * it ended, and whether that was coming down.
   */
  static fly(start: FlightState, k: number, l: number, floor: number, limit = Infinity, record = false): { path: FlightState[]; end: FlightState; landed: boolean } {
    let p = start;
    const path: FlightState[] = record ? [start] : [];
    for (let n = 0; n < 12 * 120; n++) {
      const q = BattedFlight.advance(p, k, l);
      if (q.vz < 0 && q.z <= floor && p.z > floor) {
        const end = BattedFlight.between(p, q, (p.z - floor) / (p.z - q.z));
        if (record) path.push(end);
        return { path, end, landed: true };
      }
      if (q.s >= limit) {
        const end = BattedFlight.between(p, q, (limit - p.s) / Math.max(q.s - p.s, 1e-9));
        if (record) path.push(end);
        return { path, end, landed: false };
      }
      p = q;
      if (record) path.push(p);
    }
    return { path, end: p, landed: false };
  }

  /** Its height `s` feet along. */
  static height(start: FlightState, k: number, l: number, s: number): number {
    return BattedFlight.fly(start, k, l, -Infinity, s, false).end.z;
  }

  /** The drag that brings it down `goal` feet along (false position, a few flights), and the stretch that makes up the last inches, or whatever the drag's range can't. */
  static calibrate(start: FlightState, l: number, floor: number, goal: number): [number, number] {
    const reach = (k: number) => Math.max(BattedFlight.fly(start, k, l, floor, Infinity, false).end.s, 0.1);
    let low = BattedFlight.drag.lower;
    let high = BattedFlight.drag.upper;
    let far = reach(low);
    let near = reach(high);
    if (goal >= far) return [low, goal / far];
    if (goal <= near) return [high, goal / near];
    let k = BattedFlight.airDrag;
    let r = reach(k);
    let side = 0;
    for (let i = 0; i < 8 && Math.abs(r - goal) > 0.1; i++) {
      if (r > goal) {
        low = k;
        far = r;
      } else {
        high = k;
        near = r;
      }
      // Illinois: an end kept twice running counts half, so neither stalls.
      const lean = r > goal ? 1 : -1;
      if (side === lean) {
        if (lean > 0) near = goal + (near - goal) / 2;
        else far = goal + (far - goal) / 2;
      }
      side = lean;
      k = low + ((far - goal) / (far - near)) * (high - low);
      r = reach(k);
    }
    return [k, goal / r];
  }

  /**
   * Along the ground from where it came down, `length` feet to its fielder:
   * hops, each lower and a little slower, then a roll. A ball that would stop
   * short (a dribbler the fielder charged) rolls on with less friction, as
   * far as it must. Every step, and the hops' steps.
   */
  static along(speed: number, sink: number, length: number): { path: { s: number; z: number }[]; hops: number[] } {
    if (BattedFlight.run(speed, sink, 1, length, false).reached) {
      const r = BattedFlight.run(speed, sink, 1, length, true);
      return { path: r.path, hops: r.hops };
    }
    // It would stop short: less friction, so it would roll a little past him.
    let low = 0;
    let high = 1;
    for (let i = 0; i < 12; i++) {
      const grip = (low + high) / 2;
      if (BattedFlight.run(speed, sink, grip, Infinity, false).s > length * 1.15) low = grip;
      else high = grip;
    }
    const r = BattedFlight.run(speed, sink, low, length, true);
    const last = r.path[r.path.length - 1];
    if (r.reached || !last || !(last.s > 0)) return { path: r.path, hops: r.hops };
    // Not even then (a very soft ball, a long way): the same roll, drawn out to him.
    return { path: r.path.map((p) => ({ s: (p.s * length) / last.s, z: p.z })), hops: r.hops };
  }

  /** The ground's part of a flight with friction scaled by `grip`, to `end` feet on or until it stops (10 s at most). */
  static run(speed: number, sink: number, grip: number, end: number, record: boolean): { path: { s: number; z: number }[]; hops: number[]; reached: boolean; s: number } {
    const B = BattedFlight;
    const dt = B.step;
    const k = B.airDrag;
    let s = 0;
    let z = 0;
    let v = speed;
    let vz = 0;
    let rolling = false;
    let landing = sink;
    const path: { s: number; z: number }[] = record ? [{ s: 0, z: 0 }] : [];
    const hops: number[] = [];
    for (let n = 1; n <= 10 * 120; n++) {
      if (landing < 0) {
        // A bounce: up again at a fraction of its sink, its pace scuffed in proportion.
        const up = -landing * B.restitution;
        v = Math.max(v - grip * B.scuff * (up - landing), v * 0.5);
        if (up < 2.5) {
          rolling = true;
          vz = 0;
        } else {
          vz = up;
        }
        if (n > 1 && !rolling) hops.push(n - 1);
        landing = 0;
      }
      if (rolling) {
        v = Math.max(v - (B.friction * grip + k * v * v) * dt, 0);
      } else {
        v = Math.max(v - k * v * v * dt, 0);
        z += vz * dt - (B.gravity * dt * dt) / 2;
        vz -= B.gravity * dt;
        if (z <= 0) {
          z = 0;
          landing = vz;
        }
      }
      if (s + v * dt >= end) {
        if (record) path.push({ s: end, z });
        return { path, hops, reached: true, s: end };
      }
      s += v * dt;
      if (record) path.push({ s, z });
      if (rolling && v < 0.5) break;
    }
    return { path, hops, reached: false, s };
  }
}
