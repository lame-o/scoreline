/**
 * The soccer theater's choreography (SoccerScript.swift): a `SoccerScene`
 * turned into every player's path, the ball's flights and the beats (the
 * strike, the net, the save, the headline, the stamp), in metres and
 * seconds. Built once per moment; any frame is a pure function of the script
 * and t, so the harness can draw t = 4.2 without playing 0…4.2, and the
 * tests can check that the keeper's hands are where the ball is when he
 * saves it.
 *
 * Time is the match clock's: each touch comes when ESPN logged it, the gaps
 * between them squeezed by one factor so a move fits about five seconds (a
 * long one picks up a few touches in), never quicker than the ball and the
 * man on it can go, and a ball through the air takes as long as it hangs and
 * arrives as it's met; the shot at its own pace, seen again from behind the
 * net when it's on target; then the payoff holds: the net ripples and the
 * scorer wheels away, or the keeper comes up with it (or punches it to where
 * it landed). The replay ends on the frame the theater holds until the next
 * moment.
 *
 * The men who touched the ball are where they touched it, struck with the
 * foot or the head Opta logs; with the lineups, everyone else in both
 * elevens stands in his team's shape and moves with the ball. The script
 * also says what each one does (a strike, a header, a dive, arms up), when
 * the headline lands, and where the broadcast camera looks (`PitchCamera`,
 * below).
 *
 *     const script = SoccerScript.build(scene, lineups);
 *     script.ball(2.1); script.frame(2.1); script.actors[0].position(2.1);
 */
import { CameraFrame } from "../mlb/playCamera";
import { Move } from "../mlb/playScript";
import { easeValue, fieldPoint, ground, type Ease, type FieldPoint, type Point } from "../mlb/theaterField";
import { attacksRight, characters, crossbar, goalOf, Pitch, scored, SoccerLineup, stampDetail, surname, type KeeperAction, type LineupPlayer, type Lineups, type SoccerScene, type Touch } from "./soccerScene";
import { ballMemo, Rig, RigTrack, type RigFacing } from "./rig";
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
  | "dejected"
  /** A header won in the air: up off the ground for it, then through it. */
  | "aerial"
  /** The keeper's fists to it, over his head. */
  | "punch"
  /** The keeper takes it high, in both hands, and holds it. */
  | "claim";

/** A moment of the play in his feet, head or hands. */
export interface Action {
  readonly kind: ActionKind;
  readonly at: number;
  /** Where it's aimed: he faces it. */
  readonly toward: Point;
  /** Struck with his left foot (the strike mirrored). */
  readonly left: boolean;
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
  /** ESPN's athlete ID, when it credits him. */
  athlete: string | null = null;
  /** In his team's shape: a man from the lineup who didn't touch the ball. */
  shaped = false;
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

  act(kind: ActionKind, time: number, toward: Point, left = false): void {
    this.actions.push({ kind, at: time, toward, left });
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
    /** (Its ends' heights are levelled once the moves are laid: `level`.) */
    public from: FieldPoint,
    public to: FieldPoint,
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

/** The actions a player holds once he's made them: he keeps facing what they face. */
const HELD: ReadonlySet<ActionKind> = new Set(["gather", "celebrate", "dejected"]);

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
  /** Each player's motion through the replay (his heading, stride and footfalls), measured once: by actor. */
  rig: RigTrack[] = [];

  /**
   * The moment's replay, with everyone in both starting elevens when the
   * lineups are known. (`new SoccerScript()` is the pitch with nobody on it:
   * no moment yet.)
   */
  static build(scene: SoccerScene, lineups: Lineups = {}): SoccerScript {
    const b = new Builder(scene, lineups);
    b.buildUp();
    b.strike();
    b.payoff();
    b.level();
    b.cut();
    b.squads();
    b.finish();
    b.headline();
    b.measureStamp();
    b.shoot();
    b.script.measureBodies();
    return b.script;
  }

  /**
   * Each player's motion, measured once (`RigTrack`, a 2.5 m figure), and
   * what each faces when he isn't running somewhere: what he's striking,
   * heading, throwing or taking, and from his moment on whoever he's
   * celebrating toward or the goal he turned it into; else the ball.
   */
  measureBodies(): void {
    const ball = ballMemo(this);
    this.rig = this.actors.map((actor) =>
      RigTrack.measure(0, this.duration, 2.5, (t) => actor.position(t), (t): RigFacing | null => {
        for (let i = actor.actions.length - 1; i >= 0; i--) {
          const a = actor.actions[i]!;
          if (t > a.at - 0.45 && (t < a.at + 0.2 || HELD.has(a.kind))) return { point: a.toward };
        }
        const b = ball(t);
        return b ? { point: ground(b) } : null;
      }),
    );
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
/** The shape moves no faster than a jog. */
export const jogSpeed = 6.5;
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
  /** Both starting elevens (empty: only the men who touched the ball, and the keeper). */
  readonly lineups: Lineups;

  constructor(scene: SoccerScene, lineups: Lineups = {}) {
    this.scene = scene;
    this.lineups = lineups;
    this.right = attacksRight(scene);
    this.goal = goalOf(scene);
    // The keeper first: always there, on his line.
    const start = scene.touches[0]?.at ?? scene.shot.from;
    const defending = lineups[scene.side === "top" ? "bottom" : "top"];
    this.keeper = this.actor("defending", scene.keeper.name ?? "keeper", this.keeperSpot(fieldPoint(start), null), "keeper", false, scene.keeper.credit?.athlete ?? defending?.players.find((p) => p.place === 1)?.athlete ?? null);
  }

  /**
   * The actor for a player, made the first time he's needed: by ESPN's
   * athlete ID when it credits him, else by name. The keeper is one man,
   * whatever the feed calls him.
   */
  actor(team: Team, name: string, at: Point, role: Role = "outfield", keeper = false, athlete: string | null = null): number {
    if (keeper && team === "defending" && [...this.index.values()].includes(this.keeper)) return this.keeper;
    const side = team === "attacking" ? "A" : "D";
    const known = (i: number): number => {
      if (athlete != null) {
        this.index.set(`${side}#${athlete}`, i);
        if (this.script.actors[i]!.athlete == null) this.script.actors[i]!.athlete = athlete;
      }
      return i;
    };
    if (athlete != null) {
      const i = this.index.get(`${side}#${athlete}`);
      if (i != null) return i;
    }
    const key = `${side}:${name}`;
    const named = name !== "" ? this.index.get(key) : undefined;
    if (named != null) return known(named);
    // The keeper by name: his touches are his.
    const keeperName = this.scene.keeper.name;
    if (team === "defending" && role === "outfield" && keeperName != null && name === keeperName) {
      const i = this.index.get(`D:${keeperName}`);
      if (i != null) return known(i);
    }
    const made = new Actor(team, role, name, at);
    made.athlete = athlete;
    this.script.actors.push(made);
    this.index.set(key, this.script.actors.length - 1);
    return known(this.script.actors.length - 1);
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

  /** A lofted ball's height over the line: higher the longer it goes. */
  peak(d: number, cross: boolean): number {
    return cross ? Math.min(2.2 + d * 0.09, 7) : Math.min(2.5 + d * 0.11, 11);
  }

  // MARK: Build-up

  /**
   * The move, touch by touch, at its real pace: the ball goes from each man
   * to the next (to where a pass was aimed, a punch to where it landed, then
   * at the receiver's feet to where he next played it), every player where
   * ESPN says he was when he played it, each touch when the match clock
   * says, squeezed to the replay's length.
   */
  buildUp(): void {
    const { scene, script } = this;
    const touches = this.shown(scene.touches);
    // A set piece opens on the taker standing over it.
    let t = scene.start === "openPlay" || touches.length < scene.touches.length ? 0.5 : 0.8;
    if (scene.shot.penalty) t = 1.3;
    const plan = this.beats(touches);
    const assist = this.assistIndex(touches);
    touches.forEach((touch, i) => {
      const beat = plan.beats[i]!;
      const ends = t + beat;
      const team: Team = touch.defending ? "defending" : "attacking";
      const who = this.actor(team, touch.player, touch.at, "outfield", touch.keeper, touch.credit?.athlete ?? null);
      const played = t;
      this.mark(who, t, touch.at);
      const next = this.upcoming(touches, i);
      const way = this.route(touches, i);
      // Played from the height it came to him at (off a defender's body, a keeper's fists, a head).
      const previous = script.flights[script.flights.length - 1];
      const arrived = previous && this.distance(ground(previous.to), touch.at) < 0.5 ? previous.to.z : this.height(touches, i, assist);
      const ball = fieldPoint(touch.at, arrived);
      const keeping = this.keeperAction(touch);
      const headed = touch.aerial || (i === assist && scene.assistKind === "headedPass");
      // Met where it was going at the height he takes it (his head, a keeper's fists); else along the grass.
      const met = this.distance(way.aim, next.at) < 1.5 ? (i + 1 < touches.length ? this.height(touches, i + 1, assist) : this.strikeHeight) : next.defending ? 0.9 : 0.11;
      let acted = false;
      if (way.flies) {
        const d = this.distance(touch.at, way.aim);
        let flightTime = this.flight(d, way.lofted, plan.compression, beat - way.onward);
        // Nothing waits in the air: a ball met there (a head, a keeper's fists) arrives as it's met, so the man
        // delivering it takes his time on the ground first (a corner's run-up, a touch before the cross); one
        // played on in the air (a flick-on, a punch) to a man who meets it in the air flies the whole beat.
        let kick = t;
        if (met > 1) {
          if (arrived > 1) flightTime = beat;
          else kick = Math.max(t, ends - flightTime);
          flightTime = ends - kick;
        }
        const at = kick;
        // (Over the ball until he plays it.)
        if (kick > played) this.mark(who, kick, touch.at);
        const from = scene.start === "throwIn" && touch.kind === "restart" ? fieldPoint(touch.at, 2.1) : ball;
        script.flights.push(
          new Flight(touch.kind === "shot" ? "shot" : "pass", at, at + flightTime, from, fieldPoint(way.aim, met), way.lofted ? lofted(this.peak(d, touch.kind === "cross" || touch.kind === "restart")) : STRAIGHT),
        );
        const kind: ActionKind | null =
          scene.start === "throwIn" && touch.kind === "restart"
            ? "throwIn"
            : keeping?.kind === "punch"
              ? "punch"
              : keeping?.kind === "claim"
                ? "claim"
                : touch.aerial
                  ? "aerial"
                  : headed
                    ? "header"
                    : touch.defending
                      ? null
                      : "kick";
        if (kind) {
          script.actors[who]!.act(kind, at, way.aim);
          acted = true;
        }
        const arrives = at + flightTime;
        const receiver = this.actor(next.defending ? "defending" : "attacking", next.player, way.aim, "outfield", next.keeper, next.athlete);
        this.possession.push({ from: at, to: arrives, actors: [who, receiver], flight: script.flights.length - 1 });
        const runner = way.sameMan && !next.defending ? who : receiver;
        this.mark(runner, arrives, way.aim);
        // A through ball: played into the space ahead of him, and he runs onto it.
        if (i === assist && scene.assistKind === "throughBall" && !next.defending) {
          const p = { x: way.aim.x - touch.at.x, y: way.aim.y - touch.at.y };
          const g = { x: this.goal.x - way.aim.x, y: this.goal.y - way.aim.y };
          const lp = Math.max(Math.hypot(p.x, p.y), 0.1);
          const lg = Math.max(Math.hypot(g.x, g.y), 0.1);
          const u = { x: p.x / lp + g.x / lg, y: p.y / lp + g.y / lg };
          const lu = Math.max(Math.hypot(u.x, u.y), 0.1);
          const back = Math.min(7.5 * flightTime, 9);
          this.mark(runner, at, { x: way.aim.x - (u.x / lu) * back, y: way.aim.y - (u.y / lu) * back }, null, true);
        }
        // Then on with it to where he played it next, in what's left of the beat.
        if (!next.defending && met <= 1 && this.distance(way.aim, next.at) > 1.2) this.carry(runner, way.aim, next.at, arrives + 0.06, ends);
      } else {
        this.carry(who, touch.at, next.at, t + 0.1, ends);
      }
      if (touch.defending && !acted) script.actors[who]!.act("block", played, touch.at);
      t = ends;
    });
    if (scene.start === "penalty" || touches.length === 0) {
      // No move: the taker stands over it (a penalty's run-up comes with the strike).
      script.flights.push(new Flight("carry", 0, 0.01, fieldPoint(scene.shot.from, 0.11), fieldPoint(scene.shot.from, 0.11)));
    }
    this.shooter = this.actor(scene.outcome === "ownGoal" ? "defending" : "attacking", scene.shooter, scene.shot.from, "outfield", false, scene.shooterCredit?.athlete ?? null);
    script.strike = Math.max(t, 0.6);
    this.mark(this.shooter, script.strike, scene.shot.from);
  }

  /** Who has the ball after touch `i`: the next touch's man, or the shooter. */
  upcoming(touches: readonly Touch[], i: number): { player: string; athlete: string | null; at: Point; defending: boolean; keeper: boolean } {
    const n = touches[i + 1];
    if (!n) {
      const { scene } = this;
      return { player: scene.shooter, athlete: scene.shooterCredit?.athlete ?? null, at: scene.shot.from, defending: scene.outcome === "ownGoal", keeper: false };
    }
    return { player: n.player, athlete: n.credit?.athlete ?? null, at: n.at, defending: n.defending, keeper: n.keeper };
  }

  /**
   * Where touch `i` sends the ball: a pass where it was aimed (to the next
   * man, when he's the other team's), a punch where it landed, a touch on
   * to the next man; whether it goes there in the air; whether the same man
   * plays it next (he runs on with it); and the least time the man who gets
   * it needs to take it on to his next touch.
   */
  route(touches: readonly Touch[], i: number): { aim: Point; lofted: boolean; flies: boolean; sameMan: boolean; onward: number } {
    const touch = touches[i]!;
    const next = this.upcoming(touches, i);
    const mine = touch.credit?.athlete ?? null;
    const sameMan = next.defending === touch.defending && (next.athlete != null && mine != null ? next.athlete === mine : next.player === touch.player);
    const passing = touch.kind === "pass" || touch.kind === "cross" || touch.kind === "restart" || touch.kind === "shot";
    let aim = passing && !next.defending ? (touch.to ?? next.at) : next.at;
    let isLofted = passing ? touch.lofted || (touch.kind === "restart" && this.scene.start === "throwIn") : this.distance(touch.at, next.at) > 30;
    const punch = this.keeperAction(touch);
    if (punch?.kind === "punch" && punch.to) {
      aim = punch.to;
      isLofted = true;
    }
    const flies = passing || !sameMan;
    const onward = this.distance(aim, next.at) > 1.2 && !next.defending ? 0.06 + this.distance(aim, next.at) / carrySpeed : 0.1;
    return { aim, lofted: isLofted, flies, sameMan, onward: flies ? onward : 0.1 + this.distance(touch.at, next.at) / carrySpeed };
  }

  /** How high the ball is when touch `i` meets it: at head height in the air, a keeper's fists over his head for a punch, his hands for a claim, off a defender's body; else along the grass. */
  height(touches: readonly Touch[], i: number, assist: number | null): number {
    const touch = touches[i]!;
    switch (this.keeperAction(touch)?.kind) {
      case "punch":
        return 2.5;
      case "claim":
        return 2.2;
      default:
        break;
    }
    if (touch.aerial || (i === assist && this.scene.assistKind === "headedPass")) return 1.9;
    return touch.defending ? 0.9 : 0.11;
  }

  /** The defending keeper's logged action for one of his touches: same second, same spot. */
  keeperAction(touch: Touch): KeeperAction | null {
    if (!touch.keeper) return null;
    return this.scene.keeperActions.find((a) => Math.abs(a.clock - touch.clock) <= 1 && this.distance(a.at, touch.at) < 2) ?? null;
  }

  /** The assister's touch: the last one by the man credited with the assist. */
  assistIndex(touches: readonly Touch[]): number | null {
    const { scene } = this;
    for (let i = touches.length - 1; i >= 0; i--) {
      const t = touches[i]!;
      if (t.defending) continue;
      const credited = scene.assistCredit ? scene.assistCredit.athlete === t.credit?.athlete : scene.assist != null && t.player === scene.assist;
      if (credited) return i;
    }
    return null;
  }

  /** No pass, however hurried, is quicker than this: it would read as a jump. */
  readonly minimumFlight = 0.2;

  /** A ball through the air takes as long as it hangs; one along the grass is squeezed with the rest of the move, never past 30 m/s, and leaves the man who gets it the time he needs. */
  flight(d: number, isLofted: boolean, c: number, room: number): number {
    if (isLofted) return this.passTime(d, true);
    const fastest = Math.max(d / 30, this.minimumFlight);
    return Math.max(Math.min((d / passSpeed) * c, room), fastest);
  }

  /** The least a touch's beat can be: the ball at its fastest to where it went, and the man on to his next touch. */
  least(touches: readonly Touch[], i: number): number {
    const way = this.route(touches, i);
    if (!way.flies) return way.onward;
    const d = this.distance(touches[i]!.at, way.aim);
    return (way.lofted ? this.passTime(d, true) : Math.max(d / 30, this.minimumFlight)) + way.onward;
  }

  /** The real gap after each touch on the match clock (whole seconds: a first-time touch's 0 counts as half of one), to the next or to the shot. */
  gaps(touches: readonly Touch[]): number[] {
    return touches.map((touch, i) => Math.max((touches[i + 1]?.clock ?? this.scene.clock) - touch.clock, 0.5));
  }

  /**
   * Each touch's beat, from when it's played to when the next one is: its
   * real gap, all of them squeezed by one factor (`compression`) so the move
   * fits the replay's five seconds, a quick one-two staying quick and a
   * patient spell slower; never quicker than the ball and the man on it can
   * go. A move that fits plays in real time.
   */
  beats(touches: readonly Touch[]): { beats: number[]; compression: number } {
    const real = this.gaps(touches);
    const floors = touches.map((_, i) => this.least(touches, i));
    const total = (c: number) => real.reduce((sum, gap, k) => sum + Math.max(floors[k]!, gap * c), 0);
    let c = 1;
    if (total(1) > buildUpLimit) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2;
        if (total(mid) > buildUpLimit) hi = mid;
        else lo = mid;
      }
      c = lo;
    }
    return { beats: real.map((gap, k) => Math.max(floors[k]!, gap * c)), compression: c };
  }

  /**
   * The move as the replay shows it: a long one picks up a few touches in,
   * as a broadcast replay does, rather than race through them all (squeezed
   * more than about twice); it keeps its last three touches at least.
   */
  shown(touches: readonly Touch[]): Touch[] {
    const shown = Builder.headers(touches);
    const fits = () =>
      shown.reduce((sum, _, i) => sum + this.least(shown, i), 0) <= buildUpLimit + 0.01 && this.gaps(shown).reduce((a, b) => a + b, 0) <= buildUpLimit * 2.2;
    while (shown.filter((t) => !t.defending).length > 3 && !fits()) {
      shown.shift();
      // A move never opens on the other team's touch.
      while (shown[0]?.defending === true) shown.shift();
    }
    return shown;
  }

  /** A header won in the air and the pass it was, logged as two touches a second apart ("aerial", then "pass"), as one: the header. */
  static headers(touches: readonly Touch[]): Touch[] {
    const out: Touch[] = [];
    for (const touch of touches) {
      const last = out[out.length - 1];
      if (
        last &&
        last.aerial &&
        !last.defending &&
        !touch.defending &&
        touch.clock - last.clock <= 1 &&
        (last.credit?.athlete != null ? last.credit.athlete === touch.credit?.athlete : last.player === touch.player) &&
        Math.hypot(touch.at.x - last.at.x, touch.at.y - last.at.y) < 1.5
      ) {
        out[out.length - 1] = { ...touch, aerial: true, at: last.at, clock: last.clock };
        continue;
      }
      out.push(touch);
    }
    return out;
  }

  /** He runs with it, the ball at his feet, from `start` to `end`. */
  carry(who: number, from: Point, to: Point, start: number, end: number): void {
    const time = Math.max(end - start, 0.14);
    this.mark(who, start, from);
    this.mark(who, start + time, to, "linear");
    this.script.flights.push(new Flight("carry", start, start + time, fieldPoint(from, 0.11), fieldPoint(to, 0.11)));
    this.possession.push({ from: start, to: start + time, actors: [who], flight: this.script.flights.length - 1 });
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
    // With the foot (or the head) Opta logs: a left-footer's strike is the right-footer's mirrored.
    const struck: ActionKind = scene.outcome === "ownGoal" ? "block" : s.technique === "header" ? "header" : "kick";
    script.actors[this.shooter]!.act(struck, t0, { x: target.x, y: target.y }, s.contact === "leftFoot");

    // The keeper: set as it's struck, then at full stretch, standing, or beaten (unless it's his own touch that turned it in).
    if (this.shooter === this.keeper) return;
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
        // What he did with it, as the feed logs it after the shot: punched it away, claimed it high, or held it.
        const after = scene.keeperActions.find((a) => a.clock >= scene.clock && a.kind !== "save" && a.kind !== "sweep");
        if (lateral < 1.0 && (end.z < 1.9 || after?.kind === "punch" || after?.kind === "claim")) {
          // Straight at him: he takes it in, or punches it clear.
          this.mark(this.keeper, reachAt, { x: end.x - side * 0.35, y: end.y });
          const kind: ActionKind = after?.kind === "punch" ? "punch" : after?.kind === "claim" || end.z > 1.5 ? "claim" : "gather";
          script.actors[this.keeper]!.act(kind, reachAt, s.from);
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
    if (scene.review === "overturned") {
      // Struck off by VAR: he wheels away, and it's taken back.
      this.mark(this.shooter, t + 0.2, from);
      this.mark(this.shooter, t + 1.4, { x: from.x - (right ? 1 : -1) * 5, y: Math.max(from.y - 4, 2.5) }, "out");
      script.actors[this.shooter]!.act("dejected", t + 1.35, goal);
      this.payoffAt = t + 1.6;
      return;
    }
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
    const away = (i: number) => this.distance(this.lastMark(i) ?? script.actors[i]!.at, spot);
    const near = teammates.filter((i) => away(i) < 20).sort((a, b) => rank(a) - rank(b) || away(a) - away(b));
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

  /**
   * The ball never jumps: each flight leaves from where, and as high as, the
   * one before came down (a header's flick-on from his head, a punch from
   * the keeper's fists); a shot struck at head height or on the volley is
   * met there by the ball that came to it.
   */
  level(): void {
    const flights = this.script.flights;
    for (let k = 1; k < flights.length; k++) {
      const a = flights[k - 1]!;
      const b = flights[k]!;
      if (!(b.start <= a.end + 0.2 && this.distance(ground(b.from), ground(a.to)) < 1.5 && Math.abs(b.from.z - a.to.z) > 0.001)) continue;
      if (b.kind === "shot") a.to = { ...a.to, z: b.from.z };
      else b.from = { ...b.from, z: a.to.z };
    }
  }

  // MARK: Shape

  /**
   * Everyone in both starting elevens who didn't touch the ball, in his
   * team's shape (the lineup's formation) as the ball moves: the attack
   * pushed up behind the ball and drawn across to it, the defense between
   * the ball and its goal, tighter the nearer it comes; at a corner or a
   * free kick both packed into the box until the delivery's in; on a counter
   * the defense caught upfield, getting back. A substitute who touched it
   * stands in for a man who came off. A man in the move comes into his first
   * touch from his place in the shape. Two lines and a front, at a jog.
   */
  squads(): void {
    const { scene, script, right } = this;
    const other = scene.side === "top" ? "bottom" : "top";
    const attack = this.lineups[scene.side];
    const defence = this.lineups[other];
    if (!attack || !defence || attack.players.length < 10 || defence.players.length < 10) return;
    // (Swift's floating stride: each time k × 0.6, not a running sum.)
    const times: number[] = [];
    for (let k = 0; k * 0.6 < script.strike; k++) times.push(k * 0.6);
    times.push(script.strike, script.arrive + 0.8);
    const balls = times.map((t) => {
      const b = script.ball(Math.min(t, script.strike));
      return b ? ground(b) : scene.shot.from;
    });
    const firstMark = (i: number) => {
      let first: Mark | null = null;
      for (const m of this.marks.get(i) ?? []) if (!first || m.t < first.t) first = m;
      return first;
    };
    for (const [team, lineup, facing] of [
      ["attacking", attack, right],
      ["defending", defence, !right],
    ] as const) {
      const players = [...lineup.players];
      const figures = script.actors.flatMap((a, i) => (a.team === team ? [i] : []));
      const athletes = new Set(figures.flatMap((i) => script.actors[i]!.athlete ?? []));
      // A substitute in the move takes the place of a man who went off (else of the nearest who didn't touch it).
      for (const i of figures) {
        const athlete = script.actors[i]!.athlete;
        if (!(athlete != null && !players.some((p) => p.athlete === athlete))) continue;
        if (!(script.actors[i]!.role !== "keeper" || team === "attacking")) continue;
        const first = firstMark(i)?.at ?? script.actors[i]!.at;
        const gap = (k: number) => this.distance(this.home(players[k]!, facing), first);
        const open = players.flatMap((p, k) => (!athletes.has(p.athlete) && p.place !== 1 ? [k] : []));
        const nearestOf = (list: readonly number[]) => list.reduce<number | null>((m, k) => (m == null || gap(k) < gap(m) ? k : m), null);
        const k = nearestOf(open.filter((k) => players[k]!.subbedOut)) ?? nearestOf(open);
        if (k != null) players.splice(k, 1);
      }
      const lines = players.length > 0 ? Math.max(...players.map((p) => p.line)) : 4;
      for (const p of players) {
        // The defending keeper is the keeper already on his line.
        if (team === "defending" && p.place === 1) continue;
        const places = times.map((t, k) => this.shape(p, team, facing, lines, balls[k]!, t));
        const known = figures.find((i) => script.actors[i]!.athlete === p.athlete);
        if (known != null) {
          // In the move: from his place in the shape into his first touch, if he can get there.
          const first = firstMark(known);
          if (first && first.t > 0.3 && this.distance(places[0]!, first.at) <= runSpeed * 0.8 * first.t) this.mark(known, 0, places[0]!, null, true);
          continue;
        }
        const i = this.actor(team, p.name ?? p.athlete, places[0]!, p.place === 1 ? "keeper" : "outfield", false, p.athlete);
        script.actors[i]!.shaped = true;
        times.forEach((t, k) => this.mark(i, t, places[k]!, null, true));
      }
    }
  }

  /** A man's nominal spot, in metres on the pitch. */
  home(p: LineupPlayer, right: boolean): Point {
    const n = Pitch.metres(p.spot.x, p.spot.y);
    return right ? n : { x: Pitch.length - n.x, y: Pitch.width - n.y };
  }

  /** Where a man stands in his team's shape with the ball at `ball`, at t: worked in his team's own frame (attacking toward x = 105), then turned onto the pitch. */
  shape(p: LineupPlayer, team: Team, right: boolean, lines: number, ball: Point, t: number): Point {
    const { scene, script } = this;
    const turned = (q: Point): Point => (right ? q : { x: Pitch.length - q.x, y: Pitch.width - q.y });
    const n = Pitch.metres(p.spot.x, p.spot.y);
    const b = turned(ball);
    // The defense's back line, in its own frame: deeper and tighter the nearer the ball (at x from its goal).
    const backLine = (bx: number) => Math.min(Math.max(bx * 0.45 + 2, 6), 34);
    let q: Point;
    if (team === "attacking") {
      if (p.place === 1) {
        q = { x: n.x + Math.max(b.x - 52.5, 0) * 0.3, y: 34 + (b.y - 34) * 0.15 };
      } else {
        q = { x: n.x + (b.x - 52.5) * 0.6, y: 34 + (n.y - 34) * 0.9 + (b.y - 34) * 0.3 };
        // Onside: no further than the defense's back line, or the ball.
        q = { x: Math.min(q.x, Math.max(Pitch.length - backLine(Pitch.length - b.x) + 0.5, b.x)), y: q.y };
      }
    } else {
      const k = Math.min(Math.max(b.x / 55, 0.35), 1);
      let back = backLine(b.x);
      // On the counter: caught upfield at first, getting back as the move goes.
      if (scene.shot.situation === "fastBreak") back += (Math.max(back, 40) - back) * (1 - Rig.smooth(t / Math.max(script.strike, 0.1)));
      q = { x: back + (n.x - 21) * k, y: 34 + (n.y - 34) * (0.7 + 0.25 * k) + (b.y - 34) * 0.35 };
    }
    // A corner or a free kick into the box: packed in until the delivery's in, then back out to the shape.
    const restart = scene.start === "corner" || scene.start === "freeKick";
    const situation = scene.shot.situation;
    const secondPhase = scene.start === "openPlay" && (situation === "corner" || situation === "setPiece" || situation === "freeKick");
    if (restart || secondPhase) {
      const until = restart ? (script.flights[0]?.end ?? 0) : 0;
      const w = 1 - Rig.smooth((t - until) / 1.8);
      if (w > 0) {
        const across = (p.place % 5) / 4;
        let packed: Point;
        if (team === "attacking") {
          const central = SoccerLineup.lateral(p.position) !== 2 && SoccerLineup.lateral(p.position) !== -2;
          packed = p.place === 1 ? q : (p.line === 1 && central) || p.line >= 3 ? { x: 93 + (p.place % 3) * 2.5, y: 27 + 14 * across } : { x: 60 + p.line * 5, y: n.y };
        } else {
          packed = p.line === lines ? { x: 26, y: 34 + (n.y - 34) * 0.4 } : { x: 3.5 + (p.line - 1) * 3, y: 34 + (n.y - 34) * 0.42 };
        }
        q = { x: q.x + (packed.x - q.x) * w, y: q.y + (packed.y - q.y) * w };
      }
    }
    q = { x: Math.min(Math.max(q.x, 1), Pitch.length - 1), y: Math.min(Math.max(q.y, 1.5), Pitch.width - 1.5) };
    return turned(q);
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
      if (actor.role === "keeper" || actor.shaped || first.t === 0) {
        actor.at = first.at;
      } else if (!(scene.shot.penalty && i === this.shooter)) {
        // Into his first touch from a couple of strides off it, so he's moving when it comes.
        const lead = Math.min(first.t * 2.5, 3.0);
        actor.at = { x: first.at.x - side * lead * 0.7, y: first.at.y - lead * 0.7 };
      }
      let previous: Mark = { t: 0, at: actor.at, ease: null, soft: false };
      // The shape jogs; the men in the move run.
      const pace = actor.shaped ? jogSpeed : runSpeed;
      for (const mark of list) {
        const m = { ...mark };
        // Back to his line after coming out, the keeper arrives when he can; the shape gets as far as a jog takes it.
        if (m.soft && m.t > previous.t) {
          const d = this.distance(previous.at, m.at);
          const reach = pace * (m.t - previous.t);
          if (d > reach) m.at = { x: previous.at.x + ((m.at.x - previous.at.x) * reach) / d, y: previous.at.y + ((m.at.y - previous.at.y) * reach) / d };
        }
        const d = this.distance(previous.at, m.at);
        if (m.ease != null) {
          // On the ball (or a dive): exactly from the mark before.
          if (d > 0.02) actor.move([m.at], previous.t, m.t, m.ease);
        } else if (d > 0.05 && actor.shaped) {
          // The shape drifts steadily from one place to the next.
          actor.move([m.at], previous.t, m.t, "linear");
        } else if (d > 0.05) {
          // Off it: sets off in time to get there at a run, never before the mark before.
          const need = d / pace;
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
    switch (scene.review === "overturned" ? "overturned" : scene.outcome) {
      case "overturned":
        banner("NO GOAL", "neutral", t + 1.1);
        break;
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
    const arrive = script.arrive;
    const principals = script.actors.filter((a) => !a.shaped);
    /**
     * The track, making room for the stamp from `early` before it lands, with
     * `margin` more than its corner (someone walking into it is out again
     * before the camera catches up), looking `ahead` at where everyone's
     * going, and minding (by `reach`) men just past the edge of the view.
     */
    const track = (early: number, margin: number, ahead: number, reach: number): CameraFrame[] =>
      CameraFollow.samples(script.settle, (t) => {
        let k = 0;
        for (let i = shots.length - 1; i >= 0; i--) {
          if (shots[i]!.from <= t) {
            k = i;
            break;
          }
        }
        const shot = shots[k]!;
        const rooms = shot.rooms(script, t, goal);
        // (Behind the cut from behind the goal, the main camera makes room for the stamp unseen; on it, never before
        // the shot's there: it pushes in for the shot, it doesn't widen for a stamp to come.)
        if (!(t >= Math.min(Math.max(stamp - early, arrive + 0.05), reverse?.from ?? Infinity))) return PitchCamera.fitting(rooms, band(t), shot.closest);
        // The stamp never sits on anyone in the play, in view or not (a teammate running to the scorer).
        const everyone: Room[] = [];
        for (const a of principals) {
          for (let n = 0; t + n * 0.3 <= t + ahead; n++) everyone.push(room(fieldPoint(a.position(t + n * 0.3)), true));
        }
        return PitchCamera.fitting(rooms, band(t), shot.closest, { width: corner.width + margin, height: corner.height + margin + 0.01 }, cornerRight, everyone, STAND, reach);
      });
    /**
     * How many frames once the stamp is down have a man in the play standing
     * in its corner, as the camera (a beat behind its goal) actually frames
     * them (through PitchProjection's lens, inline: soccerTheater.ts imports
     * this module).
     */
    const crowded = (samples: readonly CameraFrame[]): number => {
      const view = { width: 2, height: 1 };
      let count = 0;
      for (let n = 0; stamp + 0.2 + n / 30 <= script.duration; n++) {
        const t = stamp + 0.2 + n / 30;
        if (reverse && t >= reverse.from && t < reverse.until) continue;
        const frame = CameraFollow.frame(samples, t);
        if (!frame) continue;
        const b = PitchCamera.basis(frame, STAND);
        const half = Math.max(frame.span, 1) / 2 / b.distance;
        const focal = Math.max(Math.min(view.height / 2 / half, view.width / 2 / (half * CameraFrame.aspect)), 1);
        const inCorner = principals.some((a) => {
          const p = a.position(t);
          const q = b.tangent({ x: p.x, y: p.y, z: 0 });
          const x = (view.width / 2 + q.u * focal) / view.width;
          const y = (view.height / 2 - q.v * focal) / view.height;
          return (cornerRight ? x > 1 - corner.width : x < corner.width) && x > 0 && x < 1 && y > 1 - corner.height && y < 1;
        });
        if (inCorner) count += 1;
      }
      return count;
    };
    // The plainest track that keeps the corner clear; failing that, more care, a step at a time.
    let best: { samples: CameraFrame[]; crowded: number } | null = null;
    const care = [
      [0.3, 0.03, 0.3, 0.0],
      [0.6, 0.05, 0.9, 0.0],
      [0.9, 0.05, 0.9, 0.1],
      [1.2, 0.08, 1.2, 0.2],
      [1.6, 0.08, 1.5, 0.4],
      [2.0, 0.1, 1.8, 0.8],
    ] as const;
    for (const [early, margin, ahead, reach] of care) {
      const samples = track(early, margin, ahead, reach);
      const count = crowded(samples);
      if (best == null || count < best.crowded) best = { samples, crowded: count };
      if (count === 0) break;
    }
    script.camera = best?.samples ?? [];
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
   * or the one behind a goal (`angle`). With `reach`, a bystander just past
   * the edge of the view counts too (a camera still easing in from wider
   * shows him).
   */
  fitting(
    items: readonly Room[],
    headroom: number,
    closest: number,
    corner: { readonly width: number; readonly height: number } = NO_CORNER,
    cornerRight = false,
    others: readonly Room[] = [],
    angle: Angle = STAND,
    reach = 0,
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
        // (Clearing one man can bring the next in: a few more goes than there are usually men to clear.)
        for (let k = 0; k < 10; k++) {
          const across = (u: number) => 0.5 + (u - cu) / (2 * h * aspect);
          const upward = (v: number) => 0.5 + (v - cv) / (2 * h);
          const shown = (b: { u0: number; u1: number; v0: number; v1: number }) => across(b.u1) > -reach && across(b.u0) < 1 + reach && upward(b.v1) > -reach && upward(b.v0) < 1;
          // In the corner: the stamp's side of the view, low down (with `reach`, a bystander just past the edge counts).
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
