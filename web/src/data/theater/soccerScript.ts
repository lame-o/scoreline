/**
 * The soccer theater's choreography (SoccerScript.swift): a `SoccerScene`
 * turned into every player's path, the ball's flights and the beats (the
 * strike, the net, the save, the headline, the stamp), in metres and
 * seconds. Built once per moment; any frame is a pure function of the script
 * and t, so the harness can draw t = 4.2 without playing 0…4.2, and the
 * tests can check that the keeper's hands are where the ball is when he
 * saves it.
 *
 * Time is a broadcast replay's: the build-up a little quicker than the
 * game's (passes at 24 m/s, the man on the ball at 8.5), so eight passes take
 * about five seconds, not twenty; the shot at its own pace; then the payoff
 * holds: the net ripples and the scorer wheels away, or the keeper comes up
 * with it. The replay ends on the frame the theater holds until the next
 * moment.
 *
 * Every figure is a player who touched the ball, standing where he touched
 * it, and the keeper; nobody is invented. The script also says what each one
 * does (a strike, a header, a dive, arms up), when the headline lands, and
 * where the broadcast camera looks (`PitchCamera`, below).
 *
 *     const script = SoccerScript.build(scene);
 *     script.ball(2.1); script.frame(2.1); script.actors[0].position(2.1);
 */
import { CameraFrame } from "../mlb/playCamera";
import { Move } from "../mlb/playScript";
import { easeValue, fieldPoint, ground, type Ease, type FieldPoint, type Point } from "../mlb/theaterField";
import { attacksRight, characters, crossbar, goalOf, Pitch, scored, stampDetail, surname, type SoccerScene, type Touch } from "./soccerScene";
import { CameraFollow } from "./theaterKit";
import { BIG_CHANCE_XG } from "../liveFeeds/soccer";

export type Team = "attacking" | "defending";

export type Role = "outfield" | "keeper";

export type ActionKind =
  /** A pass, a cross or a shot struck. */
  | "kick"
  | "header"
  /** Takes it down. */
  | "control"
  /** Both hands over his head: a throw-in. */
  | "throwIn"
  /** Turns into a shot: a block. */
  | "block"
  /** The keeper takes it in his hands, standing. */
  | "gather"
  /** Arms up, held. */
  | "celebrate"
  /** Hands on his head, held. */
  | "dejected";

/** A moment of the play in his feet, head or hands. */
export interface Action {
  readonly kind: ActionKind;
  readonly at: number;
  /** Where it's aimed: he faces it. */
  readonly toward: Point;
}

/** The keeper at full stretch: from `start` his hands go to `target`, reaching it at `reach`; then he's down. */
export interface Dive {
  readonly start: number;
  readonly reach: number;
  readonly target: FieldPoint;
  /** Where he lands, on the grass. */
  readonly landing: Point;
}

export class Actor {
  team: Team;
  role: Role;
  name: string;
  at: Point;
  moves: Move[] = [];
  actions: Action[] = [];
  dive: Dive | null = null;

  constructor(team: Team, role: Role, name: string, at: Point) {
    this.team = team;
    this.role = role;
    this.name = name;
    this.at = at;
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

  /** Metres a second along the ground at t, and which way (null: standing). */
  motion(t: number): { speed: number; heading: Point } | null {
    let move: Move | undefined;
    for (let i = this.moves.length - 1; i >= 0; i--) {
      if (t >= this.moves[i]!.start) {
        move = this.moves[i];
        break;
      }
    }
    if (!move || !(t < move.end) || !(move.length > 0.2)) return null;
    const t0 = Math.max(t - 0.02, move.start);
    const t1 = Math.min(t + 0.02, move.end);
    const a = move.point(t0);
    const b = move.point(t1);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = t1 - t0;
    if (!(d > 0.002) || !(dt > 0)) return null;
    return { speed: d / dt, heading: { x: (b.x - a.x) / d, y: (b.y - a.y) / d } };
  }

  act(kind: ActionKind, time: number, toward: Point): void {
    this.actions.push({ kind, at: time, toward });
  }

  move(path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    this.moves = this.moves.filter((m) => m.start < start);
    const origin = this.position(start);
    const last = path[path.length - 1];
    if (!last || !(Math.hypot(last.x - origin.x, last.y - origin.y) > 0.05 || path.length > 1)) return;
    this.moves.push(new Move(start, Math.max(end, start + 0.05), [origin, ...path], ease));
  }
}

export type FlightKind =
  /** At a player's feet as he runs with it. */
  | "carry"
  | "pass"
  | "shot"
  /** Off a save, a block, the woodwork; on into the net. */
  | "loose";

export type Arc =
  | { readonly kind: "straight" }
  /** Up to `peak` metres over the line between its ends. */
  | { readonly kind: "lofted"; readonly peak: number };

const STRAIGHT: Arc = { kind: "straight" };
const lofted = (peak: number): Arc => ({ kind: "lofted", peak });

export class Flight {
  constructor(
    readonly kind: FlightKind,
    readonly start: number,
    readonly end: number,
    readonly from: FieldPoint,
    readonly to: FieldPoint,
    readonly arc: Arc = STRAIGHT,
    readonly ease: Ease = "linear",
  ) {}

  point(t: number): FieldPoint {
    const raw = this.end > this.start ? Math.min(Math.max((t - this.start) / (this.end - this.start), 0), 1) : 1;
    const u = easeValue(this.ease, raw);
    const { from, to } = this;
    let z = from.z + (to.z - from.z) * u;
    if (this.arc.kind === "lofted") z += 4 * this.arc.peak * u * (1 - u);
    return { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z };
  }
}

/** What the ball hits: the net (it ripples), a post or the bar (it rings), the keeper's hands, a body in the way. */
export interface Impact {
  readonly kind: "net" | "woodwork" | "save" | "block";
  readonly at: number;
  readonly point: FieldPoint;
}

/**
 * The headline across the top for a marquee moment: GOAL, SAVE, OFF THE
 * POST, PENALTY, OWN GOAL. It lands with the payoff and clears before the
 * replay ends; a penalty's comes as the kick is set and gives way to the
 * outcome's. Tones: team (the scoring team's color), gold (a late winner or
 * equalizer), neutral (ink: a save, the woodwork, a miss).
 */
export interface Banner {
  text: string;
  tone: "team" | "gold" | "neutral";
  at: number;
  until: number;
  /** It brings its own confetti (a goal). */
  confetti: boolean;
}

export class SoccerScript {
  actors: Actor[] = [];
  flights: Flight[] = [];
  impacts: Impact[] = [];
  /** The shot's flight: traced brighter than the passes before it. */
  shot: number | null = null;
  /** When it's struck, and when it gets where it was going. */
  strike = 0;
  arrive = 0;
  banners: Banner[] = [];
  /** When the stamp lands. */
  stamp = Infinity;
  /**
   * The stamp's corner of the view (bottom left; bottom right when the
   * goal is on the left), as fractions of its width and height: the camera
   * keeps the play out of it.
   */
  corner = { width: 0, height: 0 };
  cornerRight = false;
  /** The ball fades from here (a miss gone into the crowd). */
  ballGone = Infinity;
  /** The keeper who held on to it, and from when: the ball is in his hands. */
  heldBy: number | null = null;
  heldFrom = Infinity;
  /** When the action has stopped: the frame it holds from here is the one shown until the next moment. */
  settle = 0;
  duration = 0;
  shots: Shot[] = [];
  /** The main camera's track. */
  camera: CameraFrame[] = [];
  /** The cut behind the goal for a shot on target. */
  reverse: Reverse | null = null;

  /** The moment's replay. (`new SoccerScript()` is the pitch with nobody on it: no moment yet.) */
  static build(scene: SoccerScene): SoccerScript {
    const b = new Builder(scene);
    b.buildUp();
    b.strike();
    b.payoff();
    b.cut();
    b.finish();
    b.headline();
    b.measureStamp();
    b.shoot();
    return b.script;
  }

  /** The ball at t: in flight, held where its last flight ended, or gone. */
  ball(t: number): FieldPoint | null {
    const first = this.flights[0];
    if (!first || !(this.ballGone === Infinity || t < this.ballGone + 0.3)) return null;
    let held = first.from;
    for (const flight of this.flights) {
      if (t < flight.start) return held;
      if (t <= flight.end) return flight.point(t);
      held = flight.to;
    }
    return held;
  }

  ballOpacity(t: number): number {
    return Number.isFinite(this.ballGone) ? 1 - Math.min(Math.max((t - this.ballGone) / 0.3, 0), 1) : 1;
  }

  /** The framing at t: the main camera's track (held on its last frame once the play has settled), or the cut behind the goal. */
  frame(t: number): PitchFrame {
    const reverse = this.reverse;
    if (reverse && t >= reverse.from && t < reverse.until) return new PitchFrame(reverse.frame, { kind: "behind", right: reverse.right });
    return new PitchFrame(CameraFollow.frame(this.camera, t) ?? PitchCamera.rest);
  }
}

/**
 * From just after the strike until the finish has been seen, the replay
 * cuts to a camera behind the net the shot is going at, held still, as
 * broadcasts show it; then back to the main camera.
 */
export interface Reverse {
  readonly from: number;
  readonly until: number;
  /** Behind the goal on the right (the home team's attack). */
  readonly right: boolean;
  frame: CameraFrame;
}

// MARK: - Building

// Replay pace: metres a second, and the shortest and longest beats.
/** A pass along the grass. */
export const passSpeed = 24;
/** Through the air: slower, and it hangs. */
export const loftSpeed = 19;
/** The man on the ball. */
export const carrySpeed = 8.5;
/** Off-the-ball runs never look faster than a sprint. */
export const runSpeed = 9;
/** The build-up runs no longer than this, if it can help it: a longer move plays its early passes faster. */
export const buildUpLimit = 5.0;

interface Mark {
  t: number;
  at: Point;
  ease: Ease | null;
  /** Where he'd like to be (the keeper tracking the ball), not where he must: if he can't get there at a run, he gets as far as he can. */
  soft: boolean;
}

/** The latest mark (the first of equals, as Swift's `max(by:)`). */
function latestMark(list: readonly Mark[] | undefined): Mark | null {
  let best: Mark | null = null;
  for (const m of list ?? []) if (!best || best.t < m.t) best = m;
  return best;
}

/** Assembles a script beat by beat. */
export class Builder {
  readonly scene: SoccerScene;
  script = new SoccerScript();
  /** Actor index by team and name. */
  index = new Map<string, number>();
  /**
   * Where and when each actor has to be: on the ball, or meeting it. A mark
   * with an ease is reached by a move that starts exactly at the mark before
   * (running with the ball, a dive); otherwise he sets off in time to get
   * there at a run.
   */
  marks = new Map<number, Mark[]>();
  /** When the man on the ball has it, and where it's going next, for the camera. */
  possession: { from: number; to: number; actors: number[]; flight: number }[] = [];
  shooter = 0;
  keeper = 0;
  /** The shot's end: where it crosses the line, meets the keeper or the block. */
  end: FieldPoint = { x: 0, y: 0, z: 0 };
  payoffAt = 0;
  readonly right: boolean;
  readonly goal: Point;

  constructor(scene: SoccerScene) {
    this.scene = scene;
    this.right = attacksRight(scene);
    this.goal = goalOf(scene);
    // The keeper first: always there, on his line.
    const start = scene.touches[0]?.at ?? scene.shot.from;
    this.keeper = this.actor("defending", scene.keeper.name ?? "keeper", this.keeperSpot(fieldPoint(start), null), "keeper");
  }

  /** The actor for a player, made the first time he's needed. The keeper is one man, whatever the feed calls him. */
  actor(team: Team, name: string, at: Point, role: Role = "outfield", keeper = false): number {
    if (keeper && team === "defending" && [...this.index.values()].includes(this.keeper)) return this.keeper;
    const key = `${team === "attacking" ? "A" : "D"}:${name}`;
    const known = this.index.get(key);
    if (known != null) return known;
    // The keeper by name: his touches are his.
    const keeperName = this.scene.keeper.name;
    if (team === "defending" && role === "outfield" && keeperName != null && name === keeperName) {
      const i = this.index.get(`D:${keeperName}`);
      if (i != null) return i;
    }
    this.script.actors.push(new Actor(team, role, name, at));
    this.index.set(key, this.script.actors.length - 1);
    return this.script.actors.length - 1;
  }

  mark(actor: number, t: number, at: Point, ease: Ease | null = null, soft = false): void {
    const list = this.marks.get(actor);
    const m: Mark = { t, at, ease, soft };
    if (list) list.push(m);
    else this.marks.set(actor, [m]);
  }

  /**
   * The keeper's spot for the ball where it is: on the line between it and
   * the middle of his goal, a stride or two off it, further out when the
   * ball's far away; at a penalty, on the line.
   */
  keeperSpot(ball: FieldPoint, override: number | null): Point {
    const dx = ball.x - this.goal.x;
    const dy = ball.y - this.goal.y;
    const d = Math.max(Math.hypot(dx, dy), 0.1);
    const out = override ?? Math.min(1.0 + d * 0.06, 4.2);
    let x = this.goal.x + (dx / d) * out;
    let y = this.goal.y + (dy / d) * out;
    y = Math.min(Math.max(y, Pitch.posts.near - 0.6), Pitch.posts.far + 0.6);
    x = this.right ? Math.min(x, Pitch.length - 0.4) : Math.max(x, 0.4);
    return { x, y };
  }

  distance(a: Point, b: Point): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  passTime(d: number, lofted: boolean): number {
    return lofted ? Math.min(Math.max(d / loftSpeed + 0.25, 0.6), 1.5) : Math.min(Math.max(d / passSpeed, 0.28), 1.1);
  }

  carryTime(d: number): number {
    return d < 1.2 ? 0.14 : Math.min(Math.max(d / carrySpeed, 0.2), 1.3);
  }

  /** A lofted ball's height over the line: higher the longer it goes. */
  peak(d: number, cross: boolean): number {
    return cross ? Math.min(2.2 + d * 0.09, 7) : Math.min(2.5 + d * 0.11, 11);
  }

  // MARK: Build-up

  /**
   * The move, touch by touch: the ball goes from each man to the next (to
   * where a pass was aimed, then at the receiver's feet to where he next
   * played it), and every player is where ESPN says he was when he played it.
   */
  buildUp(): void {
    const { scene, script } = this;
    const touches = this.shown(scene.touches);
    // A set piece opens on the taker standing over it.
    let t = scene.start === "openPlay" || touches.length < scene.touches.length ? 0.5 : 0.8;
    if (scene.shot.penalty) t = 1.3;
    const paces = this.paces(touches);
    touches.forEach((touch, i) => {
      const pace = paces[i]!;
      const team: Team = touch.defending ? "defending" : "attacking";
      const who = this.actor(team, touch.player, touch.at, "outfield", touch.keeper);
      const played = t;
      this.mark(who, t, touch.at);
      const following = touches[i + 1];
      const next = following
        ? { player: following.player, at: following.at, defending: following.defending, keeper: following.keeper }
        : { player: scene.shooter, at: scene.shot.from, defending: scene.outcome === "ownGoal", keeper: false };
      // Played on from where it came to him: at the height it arrived (off a defender's body, a keeper's hands).
      const previous = script.flights[script.flights.length - 1];
      const arrived = previous && this.distance(ground(previous.to), touch.at) < 0.5 ? previous.to.z : 0.11;
      const ball = fieldPoint(touch.at, arrived);
      const aim: Point = next.defending || touch.to == null ? next.at : touch.to;
      const sameMan = next.player === touch.player && next.defending === touch.defending;
      switch (touch.kind) {
        case "pass":
        case "cross":
        case "restart":
        case "shot": {
          // Struck toward where it was aimed; the receiver meets it there.
          const isLofted = touch.lofted || (touch.kind === "restart" && scene.start === "throwIn");
          const d = this.distance(touch.at, aim);
          const flightTime = Math.max(this.passTime(d, isLofted) * pace, this.minimumFlight);
          const from = scene.start === "throwIn" && touch.kind === "restart" ? fieldPoint(touch.at, 2.1) : ball;
          // A cross met first time arrives where it's met: at his head, or a volley's height.
          const met = i + 1 === touches.length && this.distance(aim, scene.shot.from) < 1.5 ? this.strikeHeight : 0.11;
          const to = fieldPoint(aim, next.defending ? 0.9 : met);
          script.flights.push(new Flight(touch.kind === "shot" ? "shot" : "pass", t, t + flightTime, from, to, isLofted ? lofted(this.peak(d, touch.kind === "cross")) : STRAIGHT));
          script.actors[who]!.act(scene.start === "throwIn" && touch.kind === "restart" ? "throwIn" : "kick", t, aim);
          const arrives = t + flightTime;
          const receiver = this.actor(next.defending ? "defending" : "attacking", next.player, aim, "outfield", next.keeper);
          this.possession.push({ from: t, to: arrives, actors: [who, receiver], flight: script.flights.length - 1 });
          if (sameMan && !next.defending) {
            // Played into space and run onto: he gets there as it does.
            this.mark(who, arrives, aim);
          } else {
            this.mark(receiver, arrives, aim);
          }
          t = arrives;
          // Then he takes it on to where he played it next.
          const onward = this.distance(aim, next.at);
          if (!next.defending && onward > 1.2) {
            t = this.carry(receiver, aim, next.at, t, pace);
          } else if (i + 1 < touches.length || scene.shot.technique === "foot") {
            t += 0.12 * pace;
          }
          break;
        }
        case "takeOn":
        case "touch":
        case "regain": {
          if (sameMan) {
            t = this.carry(who, touch.at, next.at, t + 0.1 * pace, pace);
          } else {
            // Knocked on to the next man (or off a defender).
            const d = this.distance(touch.at, next.at);
            const isLofted = d > 30;
            const flightTime = Math.max(this.passTime(d, isLofted) * pace, this.minimumFlight);
            script.flights.push(new Flight("pass", t, t + flightTime, ball, fieldPoint(next.at, next.defending ? 0.9 : 0.11), isLofted ? lofted(this.peak(d, false)) : STRAIGHT));
            if (!touch.defending) script.actors[who]!.act("kick", t, next.at);
            const receiver = this.actor(next.defending ? "defending" : "attacking", next.player, next.at, "outfield", next.keeper);
            this.possession.push({ from: t, to: t + flightTime, actors: [who, receiver], flight: script.flights.length - 1 });
            t += flightTime;
            this.mark(receiver, t, next.at);
            if (i + 1 < touches.length) t += 0.1 * pace;
          }
          break;
        }
      }
      if (touch.defending) script.actors[who]!.act("block", played, touch.at);
    });
    if (scene.start === "penalty" || touches.length === 0) {
      // No move: the taker stands over it (a penalty's run-up comes with the strike).
      script.flights.push(new Flight("carry", 0, 0.01, fieldPoint(scene.shot.from, 0.11), fieldPoint(scene.shot.from, 0.11)));
    }
    this.shooter = this.actor(scene.outcome === "ownGoal" ? "defending" : "attacking", scene.shooter, scene.shot.from);
    script.strike = Math.max(t, 0.6);
    this.mark(this.shooter, script.strike, scene.shot.from);
  }

  /** One touch's beat at full pace: the ball on to the next man, and his run with it. */
  length(touches: readonly Touch[], i: number): number {
    const touch = touches[i]!;
    const next = touches[i + 1]?.at ?? this.scene.shot.from;
    const to = touch.to;
    if (to != null && touch.kind !== "touch" && touch.kind !== "takeOn" && touch.kind !== "regain") {
      return this.passTime(this.distance(touch.at, to), touch.lofted) + this.carryTime(this.distance(to, next));
    }
    return this.carryTime(this.distance(touch.at, next)) + 0.1;
  }

  /** No pass, however hurried, is quicker than this: it would read as a jump. */
  readonly minimumFlight = 0.2;

  /**
   * Each touch's pace, as a broadcast replay cuts a long move: the early
   * passes hurried (up to about half again the game's pace), the last two
   * (the ball that made the chance, and its delivery) at full pace, so the
   * move slows into the finish. Only a short move that's still too long
   * hurries them too, a little.
   */
  paces(touches: readonly Touch[]): number[] {
    const lengths = touches.map((_, i) => this.length(touches, i));
    const finish = Math.max(touches.length - 2, 0);
    const early = lengths.slice(0, finish).reduce((a, b) => a + b, 0);
    const late = lengths.slice(finish).reduce((a, b) => a + b, 0);
    const limit = buildUpLimit;
    if (!(early + late > limit)) return lengths.map(() => 1);
    const hurried = Math.max((limit - late) / Math.max(early, 0.01), 0.7);
    const closing = early * hurried + late > limit ? Math.max((limit - early * hurried) / Math.max(late, 0.01), 0.85) : 1;
    return touches.map((_, i) => (i < finish ? hurried : closing));
  }

  /**
   * The move as the replay shows it: a long one picks up a few passes in, as
   * a broadcast replay does, rather than hurry them all; it keeps its last
   * three touches at least.
   */
  shown(touches: readonly Touch[]): Touch[] {
    const shown = [...touches];
    const fits = () => {
      const paces = this.paces(shown);
      return shown.reduce((sum, _, i) => sum + this.length(shown, i) * paces[i]!, 0) <= buildUpLimit + 0.01;
    };
    while (shown.filter((t) => !t.defending).length > 3 && !fits()) {
      shown.shift();
      // A move never opens on the other team's touch.
      while (shown[0]?.defending === true) shown.shift();
    }
    return shown;
  }

  /** He runs with it: the ball at his feet. */
  carry(who: number, from: Point, to: Point, t: number, pace: number): number {
    const time = this.carryTime(this.distance(from, to)) * pace;
    this.mark(who, t, from);
    this.mark(who, t + time, to, "linear");
    this.script.flights.push(new Flight("carry", t, t + time, fieldPoint(from, 0.11), fieldPoint(to, 0.11)));
    this.possession.push({ from: t, to: t + time, actors: [who], flight: this.script.flights.length - 1 });
    return t + time;
  }

  // MARK: Shot

  /** Where the ball is when it's struck: at his head for a header, in the air for a volley. */
  get strikeHeight(): number {
    switch (this.scene.shot.technique) {
      case "header":
        return 1.95;
      case "volley":
        return 0.6;
      case "foot":
        return 0.11;
    }
  }

  /**
   * The strike: from its spot to the exact point in the goal mouth (or the
   * hands, or the block). A header leaves from head height.
   */
  strike(): void {
    const { scene, script } = this;
    const s = scene.shot;
    const t0 = script.strike;
    const from = fieldPoint(s.from, this.strikeHeight);
    const mouthY = s.mouth?.y ?? Pitch.width / 2;
    const mouthZ = s.mouth?.z ?? 0.5;
    const target = { x: this.goal.x, y: mouthY, z: mouthZ };
    if (scene.outcome === "woodwork") {
      // The post it hit, or the bar.
      if (crossbar(scene)) {
        target.z = Pitch.goalHeight;
      } else {
        target.y = Math.abs(mouthY - Pitch.posts.near) < Math.abs(mouthY - Pitch.posts.far) ? Pitch.posts.near : Pitch.posts.far;
        target.z = Math.min(Math.max(mouthZ, 0.2), Pitch.goalHeight);
      }
    }
    switch (scene.outcome) {
      case "saved": {
        const stop = s.stopped;
        if (stop && s.mouth) {
          // On the shot's line, where the keeper got to it.
          const u = Math.min(Math.max((stop.x - from.x) / (target.x - from.x), 0.55), 0.98);
          this.end = { x: from.x + (target.x - from.x) * u, y: from.y + (target.y - from.y) * u, z: Math.max(from.z + (target.z - from.z) * u, 0.25) };
        } else {
          this.end = stop ? fieldPoint(stop, Math.min(mouthZ, 1.2)) : { ...target };
        }
        break;
      }
      case "blocked":
        this.end = fieldPoint(s.stopped ?? { x: from.x + (target.x - from.x) * 0.4, y: from.y + (target.y - from.y) * 0.4 }, 0.8);
        break;
      default:
        this.end = { ...target };
    }
    const end = this.end;
    const d = Math.hypot(end.x - from.x, end.y - from.y);
    const speed = s.penalty ? 25 : s.technique === "header" ? 14 : s.technique === "volley" ? 25 : 27;
    const time = Math.min(Math.max(d / speed, 0.3), 1.25);
    script.arrive = t0 + time;
    // A long shot carries a little height in the middle; a header loops down.
    const arc: Arc = s.technique === "header" ? lofted(Math.min(0.3 + d * 0.03, 0.8)) : d > 18 ? lofted(Math.min((d - 18) * 0.04, 0.9)) : STRAIGHT;
    script.shot = script.flights.length;
    script.flights.push(new Flight("shot", t0, script.arrive, from, end, arc));

    // The shooter strikes it (a header, he's up for it); a penalty taker runs up from the edge of the D.
    if (s.penalty) {
      script.actors[this.shooter]!.at = { x: s.from.x - (this.right ? 1 : -1) * 3.2, y: s.from.y - 1.8 };
    }
    // (An own goal's defender only gets something on it.)
    const struck: ActionKind = scene.outcome === "ownGoal" ? "block" : s.technique === "header" ? "header" : "kick";
    script.actors[this.shooter]!.act(struck, t0, { x: target.x, y: target.y });

    // The keeper: set as it's struck, then at full stretch, standing, or beaten.
    const set = this.keeperSpot(fieldPoint(s.from), s.penalty ? 0.2 : null);
    // A keeper who came out for it in the move (a sweep, a header won) gets back as fast as he can run,
    // and has no dive to make.
    let stranded: boolean;
    const out = latestMark(this.marks.get(this.keeper)?.filter((m) => m.t < t0));
    if (out && this.distance(out.at, set) > runSpeed * (t0 - out.t) + 1.5) {
      stranded = true;
      const back = Math.min((runSpeed * (script.arrive + 0.6 - out.t)) / this.distance(out.at, set), 1);
      this.mark(this.keeper, script.arrive + 0.6, { x: out.at.x + (set.x - out.at.x) * back, y: out.at.y + (set.y - out.at.y) * back }, null, true);
    } else {
      stranded = false;
      this.mark(this.keeper, t0, set);
    }
    // He reads it, then goes: a dive takes about half a second, whatever the shot's flight.
    const react = Math.max(s.penalty ? t0 + 0.02 : t0 + 0.1, script.arrive - 0.55);
    const reachAt = script.arrive;
    const side = this.right ? 1.0 : -1.0;
    if (stranded) {
      if (scene.outcome === "saved") script.impacts.push({ kind: "save", at: reachAt, point: end });
      if (scene.outcome === "blocked") script.impacts.push({ kind: "block", at: reachAt, point: end });
      return;
    }
    switch (scene.outcome) {
      case "saved": {
        const lateral = Math.abs(end.y - set.y);
        if (lateral < 1.0 && end.z < 1.9) {
          // Straight at him: he takes it in.
          this.mark(this.keeper, reachAt, { x: end.x - side * 0.35, y: end.y });
          script.actors[this.keeper]!.act("gather", reachAt, s.from);
        } else {
          this.dive(end, set, react, reachAt);
        }
        script.impacts.push({ kind: "save", at: reachAt, point: end });
        break;
      }
      case "goal":
      case "ownGoal":
      case "woodwork":
      case "wide": {
        // He goes for it and doesn't get there: a shot in off the post beats him by inches, one into the
        // stands he only watches.
        const lateral = Math.abs(target.y - set.y);
        if (scene.outcome === "wide" && lateral > 3.2) {
          this.mark(this.keeper, reachAt, { x: set.x, y: set.y + (target.y - set.y) * 0.15 });
        } else if (lateral < 0.8 && target.z < 1.6) {
          // Through him (or under him).
          const past = { x: target.x - side * 0.5, y: target.y + (target.y >= set.y ? 0.45 : -0.45), z: Math.max(target.z, 0.3) };
          this.dive(past, set, react + 0.04, reachAt + 0.04);
        } else {
          const short = 0.62 + (scene.outcome === "woodwork" ? 0.2 : 0);
          const hands = { x: set.x + (target.x - set.x) * 0.5, y: set.y + (target.y - set.y) * short, z: Math.max(target.z * 0.85, 0.35) };
          this.dive(hands, set, react, reachAt + 0.05);
        }
        break;
      }
      case "blocked":
        this.mark(this.keeper, reachAt, this.keeperSpot(end, null));
        script.impacts.push({ kind: "block", at: reachAt, point: end });
        break;
    }
  }

  /** His hands go to `target` (the renderer puts them exactly there), his body a stride short of it; he lands on the grass under it. */
  dive(target: FieldPoint, set: Point, start: number, reach: number): void {
    const dy = target.y - set.y;
    const landing = { x: (set.x + target.x) / 2, y: target.y - (dy >= 0 ? 1 : -1) * Math.min(Math.abs(dy) * 0.35, 1.1) };
    this.script.actors[this.keeper]!.dive = { start, reach: Math.max(reach, start + 0.12), target, landing };
    this.mark(this.keeper, start, set);
    this.mark(this.keeper, reach + 0.32, landing, "out");
  }

  // MARK: Payoff

  /**
   * What it ends in: the net rippling and the scorer wheeling away; the
   * keeper up with it, or palming it away; the post ringing; a block; a miss
   * into the crowd.
   */
  payoff(): void {
    const { scene, script, goal, end } = this;
    const t = script.arrive;
    const side = this.right ? 1.0 : -1.0;
    this.payoffAt = t;
    switch (scene.outcome) {
      case "goal":
      case "ownGoal": {
        // Over the line, into the roof or the side netting, and down.
        const net = { x: goal.x + side * 1.5, y: end.y + (end.y - scene.shot.from.y) * 0.08, z: Math.max(end.z * 0.7, 0.35) };
        script.flights.push(new Flight("loose", t, t + 0.14, end, net));
        script.flights.push(new Flight("loose", t + 0.14, t + 0.6, net, { x: goal.x + side * 1.25, y: net.y, z: 0.11 }, STRAIGHT, "out"));
        script.impacts.push({ kind: "net", at: t + 0.1, point: net });
        this.celebrate();
        break;
      }
      case "saved": {
        const rebound = scene.rebound;
        if (rebound) {
          // Palmed away: toward whoever got to it, or behind for a corner.
          const d = this.distance(ground(end), rebound);
          script.flights.push(new Flight("loose", t, t + Math.min(Math.max(d / 16, 0.35), 0.9), end, fieldPoint(rebound, 0.11), lofted(Math.min(0.6 + d * 0.06, 2.5)), "out"));
          if (rebound.x > Pitch.length || rebound.x < 0) script.ballGone = t + 0.9;
        } else {
          // Held: the ball comes down with him, in his hands (the renderer keeps it there).
          const keeper = script.actors[this.keeper]!;
          const landing = keeper.dive?.landing ?? keeper.position(t + 0.3);
          script.flights.push(new Flight("loose", t, t + 0.37, end, { x: landing.x - side * 0.3, y: landing.y, z: 0.3 }, STRAIGHT, "out"));
          script.heldBy = this.keeper;
          script.heldFrom = t;
        }
        this.regret();
        break;
      }
      case "woodwork": {
        script.impacts.push({ kind: "woodwork", at: t, point: end });
        const away = scene.rebound ?? { x: end.x + side * 3, y: end.y + (end.y < Pitch.width / 2 ? -5 : 5) };
        const d = this.distance(ground(end), away);
        script.flights.push(new Flight("loose", t, t + Math.min(Math.max(d / 15, 0.4), 1.0), end, fieldPoint(away, 0.11), lofted(Math.min(0.5 + d * 0.05, 2)), "out"));
        if (away.x > Pitch.length + 0.5 || away.x < -0.5) script.ballGone = t + 0.85;
        this.regret();
        break;
      }
      case "blocked": {
        const blocker = this.actor("defending", scene.blocker?.name ?? "blocker", { x: end.x, y: end.y });
        script.actors[blocker]!.at = { x: end.x + side * 0.35, y: end.y };
        this.mark(blocker, t, { x: end.x + side * 0.35, y: end.y });
        script.actors[blocker]!.act("block", t, scene.shot.from);
        const away = scene.rebound ?? { x: end.x - side * 6, y: end.y + (end.y < Pitch.width / 2 ? -3 : 3) };
        const d = this.distance(ground(end), away);
        script.flights.push(new Flight("loose", t, t + Math.min(Math.max(d / 14, 0.35), 1.0), end, fieldPoint(away, 0.11), lofted(Math.min(0.4 + d * 0.04, 1.5)), "out"));
        this.regret();
        break;
      }
      case "wide": {
        // Past the post and into the crowd.
        const beyond = {
          x: goal.x + side * 6,
          y: end.y + ((end.y - scene.shot.from.y) * 6) / Math.max(Math.abs(goal.x - scene.shot.from.x), 1),
          z: end.z + 0.8,
        };
        script.flights.push(new Flight("loose", t, t + 0.25, end, beyond));
        script.ballGone = t + 0.2;
        this.regret();
        break;
      }
    }
  }

  /**
   * The scorer wheels away toward the near touchline by the corner of the
   * box (out from the goalmouth, where the camera can hold him and the goal
   * together), arms going up; the man who made it runs to him; the rest of
   * the move follows.
   */
  celebrate(): void {
    const { scene, script, goal, right } = this;
    const t = script.arrive;
    if (scene.outcome !== "goal") {
      // An own goal: the defender who turned it in, head in hands.
      script.actors[this.shooter]!.act("dejected", t + 0.4, goal);
      return;
    }
    const from = scene.shot.from;
    const flag = { x: goal.x - (right ? 1 : -1) * 12, y: 0 };
    const dx = flag.x - from.x;
    const dy = flag.y - from.y;
    const d = Math.max(Math.hypot(dx, dy), 1);
    const run = Math.min(17.0, d - 3);
    const spot = { x: Math.min(Math.max(from.x + (dx / d) * run, 1.5), Pitch.length - 1.5), y: Math.max(from.y + (dy / d) * run, 2.5) };
    this.mark(this.shooter, t + 0.2, from);
    this.mark(this.shooter, t + 2.2, spot, "out");
    script.actors[this.shooter]!.act("celebrate", t + 1.85, { x: Pitch.length / 2, y: 0 });
    // The assist first to him, then whoever else is near.
    const teammates = script.actors.map((_, i) => i).filter((i) => i !== this.shooter && script.actors[i]!.team === "attacking");
    const rank = (i: number) => (script.actors[i]!.name === scene.assist ? 0 : 1);
    const near = teammates
      .filter((i) => {
        const p = this.lastMark(i) ?? script.actors[i]!.at;
        return this.distance(p, spot) < 20;
      })
      .sort((a, b) => rank(a) - rank(b));
    near.slice(0, 3).forEach((i, n) => {
      // Either side of him and a little behind, across the camera's view so they don't hide him.
      const across = (n % 2 === 0 ? -1.0 : 1.0) * (1.9 + Math.trunc(n / 2) * 1.6);
      const p = { x: spot.x + across, y: spot.y + 1.1 + n * 0.5 };
      this.mark(i, t + 0.45 + n * 0.12, this.lastMark(i) ?? script.actors[i]!.at);
      this.mark(i, t + 2.1 + n * 0.15, p, "inOut");
    });
    this.payoffAt = t + 2.2;
  }

  /** So close: the shooter's hands go to his head. */
  regret(): void {
    const { scene, script } = this;
    if (scene.outcome === "goal") return;
    const big = (scene.shot.xg ?? 0) >= BIG_CHANCE_XG || scene.outcome === "woodwork";
    if (big) script.actors[this.shooter]!.act("dejected", script.arrive + 0.45, this.goal);
    this.payoffAt = script.arrive + 0.9;
  }

  /**
   * A shot on target (in, or saved) gets the angle from behind the net: cut
   * to it a beat after the strike, held until the finish has been seen (the
   * net bulging, the keeper down with it), then back.
   */
  cut(): void {
    const { scene, script } = this;
    if (!(scene.outcome === "goal" || scene.outcome === "saved")) return;
    const from = script.strike + 0.1;
    const until = script.arrive + (scored(scene) ? 0.95 : 0.8);
    if (!(until - from > 0.6)) return;
    script.reverse = { from, until, right: this.right, frame: { x: Pitch.length / 2, y: Pitch.width / 2, span: 12 } };
  }

  lastMark(i: number): Point | null {
    return latestMark(this.marks.get(i))?.at ?? null;
  }

  // MARK: Paths and end

  /**
   * Turns the marks into runs: each man gets to every mark on time, coming
   * into the first from a few strides off it, and drifts on a little after
   * his last; the keeper shuffles across his line with the ball. Then the
   * stamp lands and the replay settles.
   */
  finish(): void {
    const { scene, script, goal } = this;
    // The keeper tracks the ball through the move.
    // (Not while he's playing it himself.)
    const own = (this.marks.get(this.keeper) ?? []).map((m) => m.t);
    for (const flight of script.flights) {
      if (!(flight.end < script.strike && flight.kind !== "shot" && !own.some((t) => Math.abs(t - flight.end) < 0.6))) continue;
      this.mark(this.keeper, flight.end, this.keeperSpot(flight.to, null), null, true);
    }
    const side = this.right ? 1.0 : -1.0;
    script.actors.forEach((actor, i) => {
      const sorted = [...(this.marks.get(i) ?? [])].sort((a, b) => a.t - b.t);
      const first = sorted[0];
      if (!first) return;
      // A mark repeated (he's still there) is one mark, reached as exactly as either asks.
      const list: Mark[] = [];
      for (const m of sorted) {
        const last = list[list.length - 1];
        if (last && Math.abs(last.t - m.t) < 0.02) {
          // A mark he must reach beats one he'd like to.
          const keep = m.soft && !last.soft ? last : m;
          list[list.length - 1] = { t: keep.t, at: keep.at, ease: m.ease ?? last.ease, soft: m.soft && last.soft };
        } else {
          list.push(m);
        }
      }
      if (actor.role === "keeper") {
        actor.at = first.at;
      } else if (!(scene.shot.penalty && i === this.shooter)) {
        // Into his first touch from a couple of strides off it, so he's moving when it comes.
        const lead = Math.min(first.t * 2.5, 3.0);
        actor.at = { x: first.at.x - side * lead * 0.7, y: first.at.y - lead * 0.7 };
      }
      let previous: Mark = { t: 0, at: actor.at, ease: null, soft: false };
      for (const mark of list) {
        const m = { ...mark };
        // Back to his line after coming out, the keeper arrives when he can.
        if (m.soft && m.t > previous.t) {
          const d = this.distance(previous.at, m.at);
          const reach = runSpeed * (m.t - previous.t);
          if (d > reach) m.at = { x: previous.at.x + ((m.at.x - previous.at.x) * reach) / d, y: previous.at.y + ((m.at.y - previous.at.y) * reach) / d };
        }
        const d = this.distance(previous.at, m.at);
        if (m.ease != null) {
          // On the ball (or a dive): exactly from the mark before.
          if (d > 0.02) actor.move([m.at], previous.t, m.t, m.ease);
        } else if (d > 0.05) {
          // Off it: sets off in time to get there at a run, never before the mark before.
          const need = d / runSpeed;
          const leave = Math.max(previous.t + 0.05, m.t - Math.max(need * 1.5, 0.3));
          actor.move([m.at], Math.min(leave, m.t - 0.05), m.t, m.t - leave > 0.6 ? "inOut" : "linear");
        }
        previous = m;
      }
    });
    // A man who passed it on keeps going a few strides, toward goal.
    script.actors.forEach((actor, i) => {
      if (actor.team !== "attacking" || i === this.shooter) return;
      const last = latestMark(this.marks.get(i));
      if (!last || !(last.t < script.strike)) return;
      const toward = { x: goal.x - last.at.x, y: goal.y - last.at.y };
      const d = Math.max(Math.hypot(toward.x, toward.y), 1);
      const step = Math.min(4.0, d * 0.25);
      actor.move([{ x: last.at.x + (toward.x / d) * step, y: last.at.y + (toward.y / d) * step }], last.t + 0.05, last.t + 1.0, "out");
    });
    const shot = script.flights.findIndex((f) => f.kind === "shot" && f.start === script.strike);
    script.shot = shot >= 0 ? shot : null;
    let lastMove = 0;
    for (const actor of script.actors) for (const m of actor.moves) lastMove = Math.max(lastMove, m.end);
    let lastFlight = 0;
    for (const f of script.flights) lastFlight = Math.max(lastFlight, f.end);
    script.stamp = script.arrive + (scored(scene) ? 0.35 : 0.25);
    // After the angle from behind the goal: the stamp lands back on the main camera.
    if (script.reverse) script.stamp = Math.max(script.stamp, script.reverse.until + 0.12);
    script.settle = Math.max(lastMove, lastFlight, this.payoffAt + 0.6, script.stamp + 0.6) + 0.5;
    script.duration = script.settle + 0.3;
  }

  /**
   * The headline for a marquee moment, landing with its payoff: GOAL (gold
   * for a late winner or equalizer), OWN GOAL, SAVE, OFF THE POST or OFF THE
   * BAR; a penalty announces itself as it's set. A block or a miss keeps to
   * the stamp.
   */
  headline(): void {
    const { scene, script } = this;
    const t = script.arrive;
    const until = script.settle - 1.3;
    const banner = (text: string, tone: Banner["tone"], at: number, end: number = until, confetti = false) => {
      script.banners.push({ text, tone, at, until: Math.max(end, at + 1.6), confetti });
    };
    if (scene.shot.penalty) banner("PENALTY", "team", 0.25, script.strike - 0.15);
    switch (scene.outcome) {
      case "goal":
        banner("GOAL", scene.decisive ? "gold" : "team", t + 0.08, until, true);
        break;
      case "ownGoal":
        banner("OWN GOAL", scene.decisive ? "gold" : "team", t + 0.08, until, true);
        break;
      case "saved":
        banner("SAVE", "neutral", t + 0.05);
        break;
      case "woodwork":
        banner(crossbar(scene) ? "OFF THE BAR" : "OFF THE POST", "neutral", t + 0.05);
        break;
      case "wide":
        if (scene.shot.penalty) banner("MISSED", "neutral", t + 0.1);
        break;
      default:
        break;
    }
    // Only one up at a time: an earlier one leaves as the next lands.
    for (let i = 0; i + 1 < script.banners.length; i++) {
      const b = script.banners[i]!;
      const next = script.banners[i + 1]!;
      if (b.until > next.at - 0.3) b.until = next.at - 0.3;
    }
    // The camera gives the headline's room back as it leaves, and has come to rest well before the replay ends.
    const last = script.banners[script.banners.length - 1];
    if (last) {
      script.settle = Math.max(script.settle, last.until + 1.3);
      script.duration = script.settle + 0.3;
    }
  }

  /**
   * The stamp's corner, measured from its type: the name at about a seventh
   * of the view's height, the detail under it at about an eighteenth, in a
   * view twice as wide as tall. It goes on the side away from the goal,
   * where the scorer won't run.
   */
  measureStamp(): void {
    const { scene, script } = this;
    const name = surname(scene.shooter);
    const line = characters(name) * 0.6 * 0.105 + characters(scene.minute) * 0.4 * 0.105;
    const detail = characters(stampDetail(scene)) * 0.68 * 0.05;
    const width = 0.05 + Math.max(line, detail) * 0.5;
    script.corner = { width: Math.min(width + 0.03, 0.62), height: 0.27 };
    script.cornerRight = !this.right;
  }

  // MARK: Camera

  /**
   * Cuts the moment into shots: riding the ball through the build-up, each
   * pass with the man it's going to and room ahead toward goal; pushing in
   * as it's struck, on the shooter, the keeper and the goal mouth; then the
   * payoff: the goal and the scorer wheeling away, the keeper with the ball,
   * the block.
   */
  shoot(): void {
    const { scene, script, goal, right } = this;
    const frame = goalFrame(right);
    const shots: Shot[] = [];
    for (const p of this.possession) {
      if (p.from < script.strike) shots.push(new Shot(Math.max(p.from - 0.15, 0), { flight: p.flight, actors: p.actors, lead: 9, closest: 16 }));
    }
    if (shots.length === 0) {
      // A penalty: the taker, the keeper and the goal.
      shots.push(new Shot(0, { actors: [this.shooter, this.keeper], points: frame, closest: 13 }));
    }
    const s = script.strike;
    // The push-in: from a beat before the strike (an operator reads the shape of it).
    shots.push(new Shot(Math.max(s - 0.4, (shots[shots.length - 1]?.from ?? 0) + 0.2), { flight: script.shot, actors: [this.shooter, this.keeper], points: frame, closest: 11 }));
    const rest = script.ball(Infinity) ?? fieldPoint(goal);
    switch (scene.outcome) {
      case "goal":
        shots.push(new Shot(script.arrive + 0.45, { actors: [this.shooter], points: [...frame, rest], closest: 13, settled: true }));
        break;
      case "ownGoal":
      case "saved":
      case "woodwork":
      case "wide":
        shots.push(new Shot(script.arrive + 0.4, { actors: [this.keeper, this.shooter], points: [...frame, ...(Number.isFinite(script.ballGone) ? [] : [rest])], closest: 12, settled: true }));
        break;
      case "blocked": {
        const blocker = script.actors.findLastIndex((a) => a.actions.some((x) => x.kind === "block" && x.at >= script.arrive - 0.01));
        shots.push(new Shot(script.arrive + 0.35, { actors: [this.shooter, ...(blocker >= 0 ? [blocker] : [])], points: [rest], closest: 12, settled: true }));
        break;
      }
    }
    script.shots = shots;
    // The angle from behind the net: the goal, the keeper where he set and where he went, the
    // shooter when he's close enough to share it (from distance the ball arrives into it), held still.
    const reverse = script.reverse;
    if (reverse) {
      const rooms = frame.slice(0, 4).map((p) => room(p, false));
      rooms.push(room(fieldPoint(script.actors[this.keeper]!.position(script.strike)), true));
      const dive = script.actors[this.keeper]!.dive;
      if (dive) rooms.push(room(dive.target, false));
      if (script.shot != null) rooms.push(room(script.flights[script.shot]!.to, false));
      const near = this.distance(scene.shot.from, goal) < 20;
      const from = near ? fieldPoint(scene.shot.from) : (script.ball(reverse.from + 0.25) ?? fieldPoint(scene.shot.from));
      rooms.push(room(from, near));
      reverse.frame = PitchCamera.fitting(rooms, CameraFrame.bannerRoom, 9, NO_CORNER, false, [], { kind: "behind", right });
    }
    const banners = script.banners;
    const stamp = script.stamp;
    const corner = script.corner;
    const cornerRight = script.cornerRight;
    const smooth = (x: number) => {
      const u = Math.min(Math.max(x, 0), 1);
      return u * u * (3 - 2 * u);
    };
    const band = (t: number): number => {
      let up = 0;
      for (const b of banners) {
        const rise = smooth((t - b.at + 0.5) / 0.4);
        const fall = smooth((t - b.until) / 0.4);
        up = Math.max(up, rise * (1 - fall));
      }
      return CameraFrame.headroom + (CameraFrame.bannerRoom - CameraFrame.headroom) * up;
    };
    script.camera = CameraFollow.samples(script.settle, (t) => {
      let k = 0;
      for (let i = shots.length - 1; i >= 0; i--) {
        if (shots[i]!.from <= t) {
          k = i;
          break;
        }
      }
      const shot = shots[k]!;
      const rooms = shot.rooms(script, t, goal);
      // (Behind the cut from behind the goal, the main camera makes room for the stamp unseen.)
      if (!(t >= Math.min(stamp - 0.3, reverse?.from ?? Infinity))) return PitchCamera.fitting(rooms, band(t), shot.closest);
      // The stamp never sits on anyone in view, in the play or not (a teammate running to the scorer).
      const everyone = script.actors.flatMap((a) => [t, t + 0.3].map((u) => room(fieldPoint(a.position(u)), true)));
      // (A little more than the stamp's corner: someone walking into it is out again before the camera catches up.)
      return PitchCamera.fitting(rooms, band(t), shot.closest, { width: corner.width + 0.03, height: corner.height + 0.04 }, cornerRight, everyone);
    });
  }
}

const NO_CORNER = { width: 0, height: 0 } as const;

// MARK: - Camera

/** A point (or direction) in metres. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The camera's axes, looking at a framing's ground point. */
export class Basis {
  constructor(
    readonly eye: Vec3,
    readonly right: Vec3,
    readonly up: Vec3,
    readonly forward: Vec3,
    /** To the ground point. */
    readonly distance: number,
  ) {}

  /** A point in the view's tangent plane: across and up, as fractions of its distance. */
  tangent(p: FieldPoint): { u: number; v: number } {
    const dx = p.x - this.eye.x;
    const dy = p.y - this.eye.y;
    const dz = p.z - this.eye.z;
    const f = this.forward;
    const r = this.right;
    const w = this.up;
    const z = Math.max(dx * f.x + dy * f.y + dz * f.z, 0.5);
    return { u: (dx * r.x + dy * r.y + dz * r.z) / z, v: (dx * w.x + dy * w.y + dz * w.z) / z };
  }
}

/** Which camera: the main one, high in the stand on the near side; or the one behind a goal, low over the net, looking out at the shot. */
export type Angle = { readonly kind: "stand" } | { readonly kind: "behind"; readonly right: boolean };

export const STAND: Angle = { kind: "stand" };

/** What the soccer theater shows at an instant: a framing, through the main camera or the one behind a goal. */
export class PitchFrame {
  constructor(
    readonly camera: CameraFrame,
    readonly angle: Angle = STAND,
  ) {}

  get x(): number {
    return this.camera.x;
  }
  get y(): number {
    return this.camera.y;
  }
  get span(): number {
    return this.camera.span;
  }

  /** Between moments: the whole pitch from the halfway line. */
  static get rest(): PitchFrame {
    return new PitchFrame(PitchCamera.rest);
  }

  static equal(a: PitchFrame, b: PitchFrame): boolean {
    return CameraFrame.equal(a.camera, b.camera) && a.angle.kind === b.angle.kind && (a.angle.kind === "stand" || (b.angle.kind === "behind" && a.angle.right === b.angle.right));
  }
}

/** Something that must stay in frame: a figure (with room for his height above his feet) or a ball or a goal's corner. */
export interface Room {
  readonly point: FieldPoint;
  readonly figure: boolean;
}

export const room = (point: FieldPoint, figure: boolean): Room => ({ point, figure });

let restFrame: CameraFrame | null = null;

/**
 * The broadcast camera: high in the main stand on the near side, panning and
 * zooming to keep the play in frame, and travelling a little along its
 * gantry toward the end the ball's at, so a goal is seen from in front of the
 * corner flag, its mouth and net open to the lens, never edge-on. A framing
 * (`CameraFrame`) is the ground point at the middle of the view, in metres,
 * and the metres from the bottom of the view to the top at that point's
 * distance.
 */
export const PitchCamera = {
  /** Behind the near touchline, and up. */
  back: 24.0,
  height: 23.0,
  /** How far along the gantry it follows the play (0: fixed on halfway). */
  travel: 0.3,
  /** The tightest framing (metres top to bottom) and the widest (the whole pitch). */
  tightest: 8.0,
  widest: 80.0,
  /** The camera behind a goal: back from the goal line, and up (over the bar). */
  behindBack: 13.0,
  behindHeight: 6.5,

  eye(frame: CameraFrame, angle: Angle = STAND): Vec3 {
    if (angle.kind === "behind") {
      // In the stand behind the goal, a little toward the side the play is on.
      return { x: angle.right ? Pitch.length + PitchCamera.behindBack : -PitchCamera.behindBack, y: Pitch.width / 2 + (frame.y - Pitch.width / 2) * 0.35, z: PitchCamera.behindHeight };
    }
    return { x: Pitch.length / 2 + (frame.x - Pitch.length / 2) * PitchCamera.travel, y: -PitchCamera.back, z: PitchCamera.height };
  },

  basis(frame: CameraFrame, angle: Angle = STAND): Basis {
    const eye = PitchCamera.eye(frame, angle);
    const lx = frame.x - eye.x;
    const ly = frame.y - eye.y;
    const lz = 0 - eye.z;
    const distance = Math.hypot(lx, ly, lz);
    const forward = { x: lx / distance, y: ly / distance, z: lz / distance };
    const sx = forward.y;
    const sy = -forward.x;
    const sl = Math.max(Math.hypot(sx, sy), 1e-9);
    const right = { x: sx / sl, y: sy / sl, z: 0 };
    const up = {
      x: right.y * forward.z - right.z * forward.y,
      y: right.z * forward.x - right.x * forward.z,
      z: right.x * forward.y - right.y * forward.x,
    };
    return new Basis(eye, right, up, forward, distance);
  },

  /** Between moments: the whole pitch from the halfway line. */
  get rest(): CameraFrame {
    if (!restFrame) {
      const corners: Point[] = [
        { x: -1, y: -1 },
        { x: Pitch.length + 1, y: -1 },
        { x: -1, y: Pitch.width + 1 },
        { x: Pitch.length + 1, y: Pitch.width + 1 },
      ];
      restFrame = PitchCamera.fitting(
        corners.map((c) => room(fieldPoint(c), false)),
        CameraFrame.headroom,
        PitchCamera.tightest,
      );
    }
    return restFrame;
  },

  /**
   * The framing that fits `items` in a view twice as wide as tall, under
   * `headroom`, no tighter than `closest` metres top to bottom, and (with a
   * `corner`) keeping them, and any of `others` in view, out of the stamp's
   * corner: it slides the least it can, or widens. Through the main camera,
   * or the one behind a goal (`angle`).
   */
  fitting(
    items: readonly Room[],
    headroom: number,
    closest: number,
    corner: { readonly width: number; readonly height: number } = NO_CORNER,
    cornerRight = false,
    others: readonly Room[] = [],
    angle: Angle = STAND,
  ): CameraFrame {
    if (items.length === 0) return PitchCamera.rest;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const item of items) {
      x0 = Math.min(x0, item.point.x);
      x1 = Math.max(x1, item.point.x);
      y0 = Math.min(y0, item.point.y);
      y1 = Math.max(y1, item.point.y);
    }
    let frame: CameraFrame = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, span: closest };
    const aspect = CameraFrame.aspect;
    const margin = CameraFrame.margin;
    const { tightest, widest } = PitchCamera;
    for (let pass = 0; pass < 6; pass++) {
      const b = PitchCamera.basis(frame, angle);
      const box = (item: Room): { u0: number; u1: number; v0: number; v1: number } => {
        const p = item.point;
        const below = item.figure ? 0.3 : 0.5;
        const above = item.figure ? 2.9 : 0.5;
        const half = item.figure ? 0.9 : 0.5;
        let u0 = Infinity;
        let u1 = -Infinity;
        let v0 = Infinity;
        let v1 = -Infinity;
        for (const q of [
          { x: p.x, y: p.y, z: p.z - below },
          { x: p.x, y: p.y, z: p.z + above },
          { x: p.x - half, y: p.y, z: p.z },
          { x: p.x + half, y: p.y, z: p.z },
          { x: p.x, y: p.y - half, z: p.z },
          { x: p.x, y: p.y + half, z: p.z },
        ]) {
          const t = b.tangent(q);
          u0 = Math.min(u0, t.u);
          u1 = Math.max(u1, t.u);
          v0 = Math.min(v0, t.v);
          v1 = Math.max(v1, t.v);
        }
        return { u0, u1, v0, v1 };
      };
      const boxes = items.map(box);
      let u0 = Infinity;
      let u1 = -Infinity;
      let v0 = Infinity;
      let v1 = -Infinity;
      for (const box of boxes) {
        u0 = Math.min(u0, box.u0);
        u1 = Math.max(u1, box.u1);
        v0 = Math.min(v0, box.v0);
        v1 = Math.max(v1, box.v1);
      }
      // Half the view's height, in the tangent plane.
      let h = Math.max((v1 - v0) / (1 - headroom - margin), (u1 - u0) / (aspect * (1 - 2 * margin))) / 2;
      h = Math.min(Math.max(h, Math.max(closest, tightest) / 2 / b.distance), widest / 2 / b.distance);
      let cu = (u0 + u1) / 2;
      let cv = (v0 + v1) / 2 + (headroom - margin) * h;
      if (corner.width > 0 && corner.height > 0) {
        // Bystanders needn't be in frame, but none may stand in the stamp's corner.
        const bystanders = others.map(box);
        for (let k = 0; k < 6; k++) {
          const across = (u: number) => 0.5 + (u - cu) / (2 * h * aspect);
          const upward = (v: number) => 0.5 + (v - cv) / (2 * h);
          const shown = (b: { u0: number; u1: number; v0: number; v1: number }) => across(b.u1) > 0 && across(b.u0) < 1 && upward(b.v1) > 0 && upward(b.v0) < 1;
          // In the corner: the stamp's side of the view, low down.
          const inside = [...boxes, ...bystanders.filter(shown)].filter((box) => upward(box.v0) < corner.height && (cornerRight ? across(box.u1) > 1 - corner.width : across(box.u0) < corner.width));
          if (inside.length === 0) break;
          const slide = cornerRight ? Math.max(...inside.map((box) => across(box.u1) - (1 - corner.width))) : Math.max(...inside.map((box) => corner.width - across(box.u0)));
          const raise = Math.max(...inside.map((box) => corner.height - upward(box.v0)));
          const roomSide = cornerRight ? Math.min(...boxes.map((box) => across(box.u0))) - margin : 1 - margin - Math.max(...boxes.map((box) => across(box.u1)));
          const roomUp = 1 - headroom - Math.max(...boxes.map((box) => upward(box.v1)));
          if (slide <= roomSide && (slide * aspect <= raise || raise > roomUp)) {
            cu += (cornerRight ? 1 : -1) * slide * 2 * h * aspect;
          } else if (raise <= roomUp) {
            cv -= raise * 2 * h;
          } else {
            h = Math.min(h * 1.15, widest / 2 / b.distance);
          }
        }
      }
      // The ground point under the view's new middle.
      const rx = b.forward.x + b.right.x * cu + b.up.x * cv;
      const ry = b.forward.y + b.right.y * cu + b.up.y * cv;
      const rz = b.forward.z + b.right.z * cu + b.up.z * cv;
      if (!(rz < -0.02)) break;
      const s = -b.eye.z / rz;
      const gx = b.eye.x + rx * s;
      const gy = b.eye.y + ry * s;
      const eye = PitchCamera.eye({ x: gx, y: gy, span: 1 }, angle);
      const distance = Math.hypot(gx - eye.x, gy - eye.y, 0 - eye.z);
      frame = { x: gx, y: gy, span: Math.min(Math.max(2 * h * distance, closest, tightest), widest) };
    }
    return frame;
  },
};

// MARK: - Shots

/** One shot of the broadcast: from when, and what it keeps in frame. */
export class Shot {
  readonly from: number;
  /** A flight's ball, now and a beat ahead. */
  readonly flight: number | null;
  /** Figures by index, now and a beat ahead. */
  readonly actors: readonly number[];
  /** Fixed spots: the goal's frame, the ball at rest. */
  readonly points: readonly FieldPoint[];
  /** Room ahead of the ball, toward the goal it's going at (metres). */
  readonly lead: number;
  /** No closer than this (metres top to bottom). */
  readonly closest: number;
  /** Frames the figures where they finish, not where they are: the payoff, held on the goal and where the scorer ends up. */
  readonly settled: boolean;

  constructor(
    from: number,
    options: { flight?: number | null; actors?: readonly number[]; points?: readonly FieldPoint[]; lead?: number; closest?: number; settled?: boolean } = {},
  ) {
    this.from = from;
    this.flight = options.flight ?? null;
    this.actors = options.actors ?? [];
    this.points = options.points ?? [];
    this.lead = options.lead ?? 0;
    this.closest = options.closest ?? 16;
    this.settled = options.settled ?? false;
  }

  rooms(script: SoccerScript, t: number, goal: Point): Room[] {
    const rooms = this.points.map((p) => room(p, false));
    const f = this.flight != null ? script.flights[this.flight] : undefined;
    if (f) {
      for (const dt of [0, 0.25, 0.5]) {
        const p = f.point(Math.min(Math.max(t + dt, f.start), f.end));
        rooms.push(room(p, false));
        rooms.push(room(fieldPoint(ground(p)), false));
      }
      if (this.lead > 0) {
        const p = f.point(Math.min(Math.max(t, f.start), f.end));
        const dx = goal.x - p.x;
        const dy = goal.y - p.y;
        const d = Math.max(Math.hypot(dx, dy), 1);
        rooms.push(room({ x: p.x + (dx / d) * Math.min(this.lead, d), y: p.y + (dy / d) * Math.min(this.lead, d) * 0.5, z: 0 }, false));
      }
    }
    for (const index of this.actors) {
      const actor = script.actors[index];
      if (!actor) continue;
      for (const dt of this.settled ? [Infinity] : [0, 0.3]) {
        rooms.push(room(fieldPoint(actor.position(t + dt)), true));
      }
    }
    return rooms;
  }
}

/** The goal's frame, for a shot that keeps it in view. */
export function goalFrame(right: boolean): FieldPoint[] {
  const x = right ? Pitch.length : 0;
  const back = right ? Pitch.length + 1.6 : -1.6;
  const { near, far } = Pitch.posts;
  return [
    { x, y: near, z: 0 },
    { x, y: far, z: 0 },
    { x, y: near, z: Pitch.goalHeight + 0.4 },
    { x, y: far, z: Pitch.goalHeight + 0.4 },
    { x: back, y: Pitch.width / 2, z: 0 },
  ];
}
