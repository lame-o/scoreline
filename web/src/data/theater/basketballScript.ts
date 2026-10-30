/**
 * The basketball theater's choreography (BasketballScript.swift): a
 * `BasketballScene` turned into ten players' paths, the ball's passes,
 * dribbles and flights, the jumps, the beats (the catch, the block, the
 * steal), the net and the rim, and the camera's shots, in feet and seconds
 * from the start of the replay. Built once per play; any frame is a pure
 * function of the script and t, so the harness can draw t = 2.1 without
 * playing 0…2.1, and the tests can check that a three leaves the shooter's
 * hand where ESPN put him and drops through the net.
 *
 * The court is seen from a high sideline, turned a third of the way round
 * so the half court reads in depth: x along the court (0 to 94), y across it
 * from the near sideline, z up. Every play is laid out in its own frame, the
 * offense attacking the basket at x = 88.75; a play at the left basket is
 * drawn turned half a turn (`Hoops.yaw`), so each team attacks the basket it
 * attacks on TV (`HoopsEnds`: the visitors at the right in the first half by
 * default, the ends swapped at halftime, the viewer's turn on top), the
 * basket in play always the one up the court.
 * Figures are true to the rim (7 ft against its 10), so a dunk is a real
 * leap; an honest parabola carries every shot, timed by gravity.
 *
 * Time is a replay's: half a second on the set, then the play at about game
 * speed (a three's flight 1.2 s), the stamp a beat after the net, and the
 * court holds the end until the camera settles. The approach (the passes,
 * the drive, the cut, up to the shooter gathering) is laid out a touch
 * quicker than life and played `approachPace` (1.2×) slower; the shot itself
 * keeps gravity's honest time.
 *
 * Web differences, none of them in what's drawn: the gridiron's view
 * (`Gridiron.view`) is copied here as `view`, and the flights are
 * `HoopFlight` (PlayScript's flight with its `samples` arc), so the court's
 * chunk loads neither the football script nor the baseball one. The dice
 * are the Mac's (`SplitMix64`, bit for bit), so each replay is the Mac's.
 *
 *     const script = BasketballScript.play(scene);
 *     script.ball(2.1); script.camera.frame(2.1);
 */
import type { Side } from "../models";
import { CameraFrame, type Rect } from "../mlb/playCamera";
import { Move } from "../mlb/playScript";
import { easeValue, fieldPoint, ground, type Ease, type FieldPoint, type Point } from "../mlb/theaterField";
import type { Formation, HoopsEnds, Lineup } from "./basketballBeats";
import { defense, made, posterized, typeCallWords, type BasketballKind, type BasketballScene, type Miss, type Person, type Rebound } from "./basketballScene";
import { ballMemo, Rig, RigTrack, type RigFacing } from "./rig";
import { seed64, SplitMix64 } from "./splitMix64";
import type { BridgeFigure } from "./theaterBridge";
import { CameraPath, CameraRig, clearing, fitting, intersects, midX, Pace, unionAll } from "./theaterKit";

// MARK: - The court

const TURN = (30 * Math.PI) / 180;

/** The court in feet, in the play's frame: the offense attacks the basket at x = 88.75. */
export const Hoops = {
  length: 94,
  width: 50,
  /** The rim the offense attacks: its center 15 in off the backboard, which stands 4 ft in from the baseline. */
  rim: { x: 88.75, y: 25 } as Point,
  rimHeight: 10,
  rimRadius: 0.75,
  board: 90,
  boardBottom: 9.5,
  boardTop: 13,
  /** The lane: 16 ft wide, the free-throw line 19 ft from the baseline. */
  lane: 8,
  freeThrow: 75,
  /**
   * The three-point line: 23 ft 9 in round the rim, 22 ft along the corners
   * for the first 14 ft (the WNBA's arc is 22 ft 1¾ in; the court's markings
   * take it as a parameter).
   */
  three: 23.75,
  corner: 22,
  /** A player as drawn, against the 10 ft rim: true to it, a touch tall. */
  height: 7,
  /** His height on the ground's scale (the rig strides in it): heights are drawn at 0.82 of the ground's feet. */
  ground: 7 * 0.82,
  /** Body units per foot of height (a jump's lift). */
  lift: 1.1 / 7,
  /** The camera's yaw: the court turned a third of the way round. */
  turn: TURN,
  /** The closest the camera comes (feet top to bottom): a shooter and the rim. */
  tightest: 24,

  /**
   * The view's turn for the team on offense: the top team's basket up and to
   * the right; the bottom team's, half a turn round, up and to the left (the
   * same court from the same sideline). The whole-game convention (the shot
   * chart's); a live play takes its end from `yawRight`.
   */
  yaw(offense: Side | null): number {
    return Hoops.yawRight(offense !== "bottom");
  },

  /** The view's turn for a play at the right basket (up and to the right), or at the left (half a turn round, up and to the left). */
  yawRight(right: boolean): number {
    return right ? -TURN : TURN + Math.PI;
  },

  /** ESPN's half-court feet toward the offense's basket, in the play's frame. */
  court(p: Point): Point {
    return { x: Hoops.board - p.y, y: Hoops.width - p.x };
  },

  /** ESPN's half-court feet toward the other basket (a steal's: the team that lost it was going that way), in the play's frame. */
  otherEnd(p: Point): Point {
    return { x: Hoops.length - Hoops.board + p.y, y: p.x };
  },

  /** The room the camera keeps round a spot, in projected feet: a figure's height and a jump above it, a ball a little. */
  room(p: FieldPoint, figure: boolean, yaw: number): Rect {
    const v = view(p, yaw);
    const x = v.x;
    const y = v.y * 0.5 + p.z * 0.82;
    const below = figure ? 2 : 2.5;
    const above = figure ? 7.5 : 2.5;
    return { x: x - 4, y: y - below, width: 8, height: below + above };
  },
};

/** A point on the court as the camera's projection takes it (x across the view, y into it): FootballScript.swift's `Gridiron.view`. */
export function view(p: Point, yaw: number): Point {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
}

// MARK: - Flights

/** How the ball goes: a gentle line, an arc `peak` feet over the line between its ends, or a measured path sampled evenly in time. */
export type HoopArc = { readonly kind: "straight" } | { readonly kind: "arc"; readonly peak: number } | { readonly kind: "samples"; readonly points: readonly FieldPoint[] };

export const STRAIGHT: HoopArc = { kind: "straight" };
export const arc = (peak: number): HoopArc => ({ kind: "arc", peak });

/** A flight of the ball (PlayScript.Flight, with its `.samples` arc), linear in time. */
export class HoopFlight {
  constructor(
    readonly start: number,
    readonly end: number,
    readonly from: FieldPoint,
    readonly to: FieldPoint,
    readonly arc: HoopArc,
  ) {}

  point(t: number): FieldPoint {
    const raw = this.end > this.start ? Math.min(Math.max((t - this.start) / (this.end - this.start), 0), 1) : 1;
    const a = this.arc;
    if (a.kind === "samples" && a.points.length > 1) {
      const n = a.points.length;
      const i = raw * (n - 1);
      const lower = Math.min(Math.trunc(i), n - 2);
      const f = i - lower;
      const p = a.points[lower]!;
      const q = a.points[lower + 1]!;
      return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f };
    }
    const u = easeValue("linear", raw);
    const { from, to } = this;
    let z = from.z + (to.z - from.z) * u;
    if (a.kind === "arc") z += 4 * a.peak * raw * (1 - raw);
    return { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z };
  }
}

// MARK: - Script

/** The two fives, and the referee who comes in to make a call (on the floor only while he's doing something). */
export type Team = "offense" | "defense" | "official";

/**
 * What he does with the ball (or reaching for it); and the lighter beats': a
 * hand on a man (a foul), knocked down (a charge), a referee's signals, a
 * jump ball's toss, waiting.
 */
export type ActionKind =
  | "catchBall"
  | "pass"
  | "lob"
  | "shoot"
  | "layup"
  | "dunk"
  | "hook"
  | "tip"
  | "contest"
  | "block"
  | "steal"
  | "rebound"
  | "boxOut"
  | "reach"
  | "fall"
  | "signal"
  | "point"
  | "toss"
  | "hips";

/** A moment of the play in his hands (or reaching for it); `toward`: what he turns to face (the rim, the man he passes to). */
export interface Action {
  readonly kind: ActionKind;
  readonly at: number;
  readonly toward: Point;
}

/** Off the floor: takeoff, the top (held `hang` seconds: a dunk's grip on the rim), landing; how high his feet get, in feet. */
export class Jump {
  constructor(
    readonly from: number,
    readonly peak: number,
    readonly until: number,
    readonly height: number,
    readonly hang = 0,
  ) {}

  /** Feet off the floor at t: up as a ball thrown up rises, held, then down the same way. */
  lift(t: number): number {
    const { from, peak, until, height, hang } = this;
    if (!(t > from && t < until)) return 0;
    if (t < peak) {
      const u = (peak - t) / Math.max(peak - from, 0.01);
      return height * (1 - u * u);
    }
    if (t < peak + hang) return height - 0.25 * Math.min(1, (t - peak) / Math.max(hang, 0.01)) * Math.min(height, 0.4);
    const down = until - peak - hang;
    const u = (t - peak - hang) / Math.max(down, 0.01);
    const top = hang > 0 ? height - Math.min(height, 0.4) * 0.25 : height;
    return top * (1 - u * u);
  }
}

export class Player {
  moves: Move[] = [];
  actions: Action[] = [];
  jumps: Jump[] = [];
  /** On the floor from `enters` until `leaves` (a substitution, the referee, a walk off at the half), fading over a third of a second. */
  enters = -Infinity;
  leaves = Infinity;

  constructor(
    readonly team: Team,
    public at: Point,
  ) {}

  opacity(t: number): number {
    return Math.min(Math.max((t - this.enters) / 0.3, 0), 1) * Math.min(Math.max((this.leaves - t) / 0.3, 0), 1);
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

  /** Feet a second along the floor at t. */
  speed(t: number): number {
    const a = this.position(t - 0.03);
    const b = this.position(t + 0.03);
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.06;
  }

  lift(t: number): number {
    let most = 0;
    for (const j of this.jumps) most = Math.max(most, j.lift(t));
    return most;
  }

  jump(t: number): Jump | null {
    return this.jumps.find((j) => t > j.from - 0.2 && t < j.until + 0.25) ?? null;
  }

  act(kind: ActionKind, at: number, toward: Point): void {
    this.actions.push({ kind, at, toward });
  }

  move(path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    this.moves = this.moves.filter((m) => m.start < start);
    const origin = this.position(start);
    const last = path[path.length - 1];
    if (!last || !(Math.hypot(last.x - origin.x, last.y - origin.y) > 0.2 || path.length > 1)) return;
    this.moves.push(new Move(start, Math.max(end, start + 0.05), [origin, ...path], ease));
  }
}

/** Where the ball is, leg by leg: in the air, in someone's hands, bounced as he goes, on the floor. */
export interface Leg {
  from: number;
  until: number;
  readonly hand:
    | { readonly kind: "flight"; readonly index: number }
    | { readonly kind: "held"; readonly player: number }
    | { readonly kind: "dribble"; readonly player: number }
    | { readonly kind: "spot"; readonly point: FieldPoint };
}

export type Beat = "catchBall" | "block" | "steal" | "rim" | "whistle" | "horn";

export interface Flash {
  readonly beat: Beat;
  readonly at: number;
  readonly point: FieldPoint;
}

/** The ball through the net: when it crosses the rim, how hard (a dunk snaps it), and which way it was going (the net swings that way). */
export interface Net {
  readonly at: number;
  readonly strength: number;
  readonly way: Point;
}

/**
 * The headline across the top: DUNK, AND-ONE, POSTERIZED, BUZZER-BEATER,
 * REJECTED. It lands with the payoff and clears as the court settles.
 * Tones: a team's own color; gold for a game-winner (or the shot that tied
 * it at the end). `confetti`: it brings its own (a buzzer-beater).
 */
export interface Banner {
  readonly text: string;
  readonly tone: { readonly kind: "side"; readonly side: Side | null } | { readonly kind: "gold" };
  readonly at: number;
  readonly until: number;
  readonly confetti: boolean;
}

/** A broadcast tag over the play: its words, whose color, and from when. */
export interface Tag {
  readonly text: string;
  readonly side: Side | null;
  readonly at: number;
}

/** What everyone standing about watches from a moment on (the referee at the table, the shooter at the line). */
export interface Look {
  readonly point: Point;
  readonly from: number;
}

export class BasketballScript {
  players: Player[] = [];
  flights: HoopFlight[] = [];
  legs: Leg[] = [];
  flashes: Flash[] = [];
  banner: Banner | null = null;
  /** When the stamp lands. */
  stamp = Infinity;
  /** The make's moment (the ball through the rim), and the net's motion. */
  score: number | null = null;
  net: Net | null = null;
  /** A dunk's rim, pulled down and let go; a rim-out's ring. */
  rimHit: number | null = null;
  rimStrength = 0;
  /** The shot's release, and who shot it. */
  release: number | null = null;
  shooter: number | null = null;
  settle = 0;
  duration = 0;
  /** The stamp's corner of the view (bottom left), as fractions of its width and height: the camera keeps the play out of it. */
  corner = { width: 0, height: 0 };
  shots: Shot[] = [];
  camera = new CameraPath({ x: 60, y: 10, span: 48 });
  yaw = Hoops.yaw("top");
  /** Each player's motion through the replay (heading, stride, footfalls), measured once: by player. */
  rig: RigTrack[] = [];
  /** The team at the basket in front (players 0–4): who the frame is for. */
  side: Side | null = null;
  /** What it says at the top while it plays (SHOOTING FOUL · HAYES), from when. */
  tag: Tag | null = null;
  /** When something moves, between plays: the court is still in between (nothing redraws). */
  active: (readonly [number, number])[] = [];
  /** The shape the floor is in: play, the lane for free throws, the benches, an empty court. */
  formation: Formation = "play";
  look: Look | null = null;
  /** A substitute who came on for a man who went off: the next beat finds him in his place. */
  stand = new Map<number, number>();
  /**
   * Who ESPN credits (the shooter, the passer, the blocker, the rebounder,
   * the man who fouled or lost it, the man coming in), on the figure the
   * play gives him: the tags over the court name him, and nobody else.
   */
  credits = new Map<number, Person>();

  room(p: FieldPoint, figure: boolean): Rect {
    return Hoops.room(p, figure, this.yaw);
  }

  /** The ten as the hand-off from the court between plays matches them (theaterBridge.ts): by side (`side` has the ball here), where each is at t. */
  bridgeFigures(t: number): BridgeFigure[] {
    const offense = this.side ?? "top";
    return this.players.map((p) => {
      const group = p.team === "offense" ? (offense === "top" ? 0 : 1) : p.team === "defense" ? (offense === "top" ? 1 : 0) : 2;
      return { group, kind: "", athlete: null, at: p.position(t) };
    });
  }

  /** The replay's own lead-in: its set's still moment before anyone (or the ball) moves, which a hand-off from the court between plays uses first. */
  get leadIn(): number {
    let first = Infinity;
    for (const p of this.players) if (p.moves[0]) first = Math.min(first, p.moves[0].start);
    for (const f of this.flights) first = Math.min(first, f.start);
    return Math.max(Number.isFinite(first) ? first : 0.45, 0);
  }

  /** Where everyone is at t, and the ball: what the next beat (or the court between plays) starts from. */
  lineup(t: number): Lineup {
    let holder = this.carrier(t)?.player ?? null;
    if (holder != null) {
      for (const [off, on] of this.stand) if (on === holder) holder = off;
    }
    if (holder != null && holder >= 10) holder = null;
    const at: Point[] = [];
    for (let i = 0; i < Math.min(this.players.length, 10); i++) at.push(this.players[this.stand.get(i) ?? i]!.position(t));
    const ball = holder == null ? this.ball(t) : null;
    return { offense: this.side, at, holder, ball: ball ? ground(ball) : null, formation: this.formation, camera: this.camera.frame(t), yaw: this.yaw };
  }

  /** The ball at t: in the air, in hand (at his chest, roughly: the frame puts it in his hands), bouncing at his side, on the floor. */
  ball(t: number): FieldPoint | null {
    const first = this.legs[0];
    if (!first) return null;
    let leg = first;
    if (!(t < first.from)) {
      for (let i = this.legs.length - 1; i >= 0; i--) {
        if (t >= this.legs[i]!.from) {
          leg = this.legs[i]!;
          break;
        }
      }
    }
    const at = Math.min(Math.max(t, leg.from), leg.until);
    const hand = leg.hand;
    switch (hand.kind) {
      case "flight":
        return this.flights[hand.index]?.point(at) ?? null;
      case "held": {
        const p = this.players[hand.player];
        return p ? fieldPoint(p.position(at), 4.4 + p.lift(at)) : null;
      }
      case "dribble": {
        const p = this.players[hand.player];
        return p ? fieldPoint(p.position(at), BasketballScript.bounce(at - leg.from) * 3.0 + 0.4) : null;
      }
      case "spot":
        return hand.point;
    }
  }

  /** How high a dribble is (0 the floor, 1 the hand), `t` into it: down fast, up slower, about two and a half a second. */
  static bounce(t: number): number {
    const phase = (t * 2.4) % 1;
    return phase < 0.42 ? 1 - Rig.smooth(phase / 0.42) : Rig.smooth((phase - 0.42) / 0.58);
  }

  /** Who has the ball at t (in his hands or on the dribble), since when, and until when. */
  carrier(t: number): { readonly player: number; readonly from: number; readonly until: number; readonly dribbling: boolean } | null {
    let i = -1;
    for (let k = this.legs.length - 1; k >= 0; k--) {
      if (t >= this.legs[k]!.from) {
        i = k;
        break;
      }
    }
    if (i < 0) return null;
    const leg = this.legs[i]!;
    const until = i + 1 < this.legs.length ? leg.until : Infinity;
    const before = i > 0 ? this.legs[i - 1]!.hand : null;
    switch (leg.hand.kind) {
      case "held": {
        // A dribble that follows a hold (or the other way) is the same man with the ball.
        const p = leg.hand.player;
        const from = before?.kind === "dribble" && before.player === p ? this.legs[i - 1]!.from : leg.from;
        return { player: p, from, until, dribbling: false };
      }
      case "dribble": {
        const p = leg.hand.player;
        const from = before?.kind === "held" && before.player === p ? this.legs[i - 1]!.from : leg.from;
        return { player: p, from, until, dribbling: true };
      }
      default:
        return null;
    }
  }

  /** The ball's flight at t, when it's in the air. */
  flight(t: number): HoopFlight | null {
    for (let i = this.legs.length - 1; i >= 0; i--) {
      const leg = this.legs[i]!;
      if (!(t >= leg.from)) continue;
      if (!(t <= leg.until) || leg.hand.kind !== "flight") return null;
      return this.flights[leg.hand.index] ?? null;
    }
    return null;
  }

  // MARK: - Building

  /**
   * How much slower a replay's approach plays than it's laid out: from the
   * set until the shooter gathers (the passes, the drive, the cut). Measured
   * on the night's replays, the men's top speeds as laid out ran past a
   * sprint (median 11 m/s, against 9–10) while the passes sat at life's
   * 10–15 m/s (median 12): 1.2× brings the men to a sprint's ceiling and
   * keeps the passes in life's band (1.3 would drop them under it). The
   * shot's flight, timed by gravity, and everything after it keep their pace.
   */
  static readonly approachPace = 1.2;

  /** A play replayed in full (the marquee). `right`: it's at the right basket (null: the whole-game convention, the top team's at the right). */
  static play(scene: BasketballScene, right: boolean | null = null, pace: number = BasketballScript.approachPace): BasketballScript {
    const b = new Builder(scene, scene.offense, right ?? scene.offense !== "bottom");
    b.build(pace);
    b.script.measureBodies();
    return b.script;
  }

  /**
   * Each player's motion, measured once (`RigTrack`), and what each faces
   * when he isn't running somewhere: what he's doing with the ball (the man
   * he passes to, the rim he shoots at); a defender his man and the ball,
   * even shuffling (only a sprint turns him); else the ball.
   */
  measureBodies(): void {
    const ball = ballMemo(this);
    const settle = this.settle;
    const look = this.look;
    this.rig = this.players.map((player) =>
      RigTrack.measure(0, this.duration, Hoops.ground, (t) => player.position(t), (t): RigFacing => {
        let near: Action | null = null;
        for (const a of player.actions) {
          if (!(t > a.at - 0.5 && t < a.at + 0.3 && a.kind !== "boxOut")) continue;
          if (near == null || Math.abs(a.at - t) < Math.abs(near.at - t)) near = a;
        }
        if (near) return { point: near.toward, always: true };
        let box: Action | null = null;
        for (let i = player.actions.length - 1; i >= 0; i--) {
          const a = player.actions[i]!;
          if (a.kind === "boxOut" && t >= a.at - 0.2) {
            box = a;
            break;
          }
        }
        if (box && t < settle) return { point: box.toward, always: true };
        const b = ball(t);
        const point = b ? ground(b) : Hoops.rim;
        if (player.team === "official") return { point, always: player.speed(t) < 6 };
        if (look && t >= look.from && player.speed(t) < 4) return { point: look.point, always: true };
        if (player.team === "defense" && player.speed(t) < 13) return { point, always: true };
        return { point };
      }),
    );
  }
}

// MARK: - Building

export const G = 32.2;
export const RIM = Hoops.rim;
export const RIM_POINT: FieldPoint = { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight };

/** Kept on the floor (and off the baseline's padding). */
export function inbounds(p: Point): Point {
  return { x: Math.min(Math.max(p.x, 1), 92.5), y: Math.min(Math.max(p.y, 1.2), 48.8) };
}

export function unit(v: Point): Point {
  const d = Math.hypot(v.x, v.y);
  return d > 1e-6 ? { x: v.x / d, y: v.y / d } : { x: -1, y: 0 };
}

export const along = (p: Point, dir: Point, d: number): Point => ({ x: p.x + dir.x * d, y: p.y + dir.y * d });

export function rotate(v: Point, a: number): Point {
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
}

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const negated = (p: Point): Point => ({ x: -p.x, y: -p.y });
export const toward = (from: Point, to: Point): Point => unit({ x: to.x - from.x, y: to.y - from.y });

export type PassStyle = "chest" | "bounce" | "lob" | "outlet";

const JUMPS: ReadonlySet<BasketballKind> = new Set(["jumper", "three"]);

/** Assembles a script beat by beat. */
export class Builder {
  readonly scene: BasketballScene | null;
  script = new BasketballScript();
  readonly random: SplitMix64;
  /** The set holds this long before anyone moves. */
  readonly open = 0.45;
  /** When the action is over (the ball on the floor, in someone's hands). */
  over = 0;
  /** The shot's arrival at the rim. */
  arrive = 0;
  /** Who has the ball (between plays, null: nobody yet). */
  readonly offense: Side | null;
  /** Which basket each team attacks, and where the benches are. */
  ends: HoopsEnds = { topRight: true, topOpensRight: true };
  /** Where the last beat left everyone, in this frame (null: set up fresh). */
  start: Lineup | null = null;
  /** Who passed to whom, the last time: the assist is the pass to the shooter. */
  passers = new Map<number, number>();

  constructor(scene: BasketballScene | null, offense: Side | null, right: boolean, seed: string | null = null) {
    this.scene = scene;
    this.offense = offense;
    this.random = new SplitMix64(seed64(seed ?? scene?.id ?? "rest"));
    this.script.yaw = Hoops.yawRight(right);
    this.script.side = offense;
  }

  /** The legs in time order, ties kept in the order they were laid down (a hold that ends as a pass leaves comes before the pass). */
  sortLegs(): void {
    this.script.legs = this.script.legs
      .map((leg, i) => ({ leg, i }))
      .sort((a, b) => (a.leg.from < b.leg.from ? -1 : a.leg.from > b.leg.from ? 1 : a.i - b.i))
      .map((x) => x.leg);
  }

  // MARK: Helpers

  get rim(): Point {
    return RIM;
  }

  position(i: number, t: number): Point {
    return this.script.players[i]!.position(t);
  }

  move(i: number, path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    this.script.players[i]!.move(path.map(inbounds), start, end, ease);
  }

  act(i: number, kind: ActionKind, t: number, p: Point): void {
    this.script.players[i]!.act(kind, t, p);
  }

  jump(i: number, from: number, peak: number, until: number, height: number, hang = 0): void {
    this.script.players[i]!.jumps.push(new Jump(from, peak, until, height, hang));
  }

  fly(from: FieldPoint, to: FieldPoint, start: number, time: number, how: HoopArc): number {
    this.script.flights.push(new HoopFlight(start, start + time, from, to, how));
    this.script.legs.push({ from: start, until: start + time, hand: { kind: "flight", index: this.script.flights.length - 1 } });
    return this.script.flights.length - 1;
  }

  hold(i: number, from: number, until: number): void {
    this.script.legs.push({ from, until, hand: { kind: "held", player: i } });
  }

  bounce(i: number, from: number, until: number): void {
    this.script.legs.push({ from, until, hand: { kind: "dribble", player: i } });
  }

  lastLegUntil(value: number): void {
    const last = this.script.legs[this.script.legs.length - 1];
    if (last) last.until = value;
  }

  lastHeld(player: number): number {
    for (let i = this.script.legs.length - 1; i >= 0; i--) {
      const h = this.script.legs[i]!.hand;
      if (h.kind === "held" && h.player === player) return i;
    }
    return -1;
  }

  /** The way out from the rim to a spot (straight out the top at the rim itself). */
  out(p: Point): Point {
    return distance(p, RIM) > 1.5 ? unit({ x: p.x - RIM.x, y: p.y - RIM.y }) : { x: -1, y: 0 };
  }

  /** The way in to the rim from a spot, from the court's side of the backboard (a spot ESPN puts under or behind it comes in along the baseline). */
  approach(p: Point): Point {
    const o = this.out(p);
    if (!(o.x > -0.3)) return o;
    return { x: -0.3, y: (o.y >= 0 ? 1 : -1) * Math.sqrt(1 - 0.09) };
  }

  /** Where a defender stands on his man: between him and the rim, close on the ball, off and toward the ball away from it. */
  guardSpot(man: Point, ball: Point, onBall: boolean): Point {
    const toRim = toward(man, RIM);
    const room = Math.min(distance(man, RIM) * 0.45, onBall ? 4 : Math.min(5.5 + 0.17 * distance(man, ball), 10.5));
    let p = along(man, toRim, Math.max(room, 1.5));
    if (!onBall) p = { x: p.x + (ball.x - p.x) * 0.12, y: p.y + (ball.y - p.y) * 0.12 };
    return p;
  }

  /** The hand's place for a shot off a jump `lift` ft high: a little ahead of him, his arm up (7 ft for a player this tall, standing). */
  release(spot: Point, lift: number, reach = 7.0): FieldPoint {
    return fieldPoint(along(spot, toward(spot, RIM), 0.45), reach + lift);
  }

  // MARK: The set

  /**
   * Five on five in the half court round the play: `fixed` are the places
   * the play needs (the shooter's start, the passer's), the rest spaced
   * round them (two on the perimeter, a big on the weak-side block), each
   * defender between his man and the rim.
   */
  lineUp(fixed: readonly Point[], ball: number): void {
    const strong = (fixed[0]?.y ?? 30) >= 25 ? 1 : -1;
    const slot = (x: number, y: number): Point => ({ x, y: 25 + y * strong });
    const perimeter = [slot(90.5, -22.5), slot(71.5, -17.5), slot(61.5, 0), slot(90.5, 22.5), slot(71.5, 17.5), slot(66, -9), slot(66, 9)];
    const bigs = [slot(86.5, -8.8), slot(86.5, 8.8), slot(90.5, -11), slot(76, 0)];
    const placed = [...fixed];
    const free = (p: Point) => placed.every((q) => distance(q, p) > 9);
    while (placed.length < 4) placed.push(perimeter.find(free) ?? perimeter[0]!);
    placed.push(bigs.find(free) ?? slot(80, -14));
    const at = placed.slice(0, 5).map((p) => {
      const x = p.x + this.random.in(-1, 1);
      const y = p.y + this.random.in(-1, 1);
      return inbounds({ x, y });
    });
    this.script.players = at.map((p) => new Player("offense", p));
    const handler = at[Math.min(ball, at.length - 1)]!;
    at.forEach((man, k) => this.script.players.push(new Player("defense", this.guardSpot(man, handler, k === ball))));
  }

  /** The defenders not otherwise busy stay on their men through the play. */
  shadow(start: number, end: number, except: ReadonlySet<number> = new Set()): void {
    this.sortLegs();
    const step = 0.25;
    for (let k = 0; k < 5; k++) {
      if (except.has(k + 5)) continue;
      let t = start;
      while (t < end - 0.01) {
        const next = Math.min(t + step, end);
        const man = this.position(k, next + 0.12);
        const b = this.script.ball(next);
        const ball = b ? ground(b) : RIM;
        const onBall = this.script.carrier(next)?.player === k;
        this.move(k + 5, [this.guardSpot(man, ball, onBall)], t, next, "linear");
        t = next;
      }
    }
  }

  // MARK: With the ball

  /** He dribbles from where he is to `p` at `speed` ft/s, starting at `t`: when he gets there. */
  drive(i: number, p: Point, t: number, speed: number, ease: Ease = "inOut"): number {
    const d = distance(this.position(i, t), p);
    const end = t + Math.max((d / speed) * (ease === "linear" ? 1 : 1.25), 0.2);
    this.move(i, [p], t, end, ease);
    return end;
  }

  /** How long a pass from `i` at `t` takes to reach `point` (so the man it's for can be there as it is). */
  passTime(i: number, t: number, point: Point, style: PassStyle): number {
    const from = this.position(i, t);
    const start = along(from, toward(from, point), 0.8);
    const d = distance(start, point);
    switch (style) {
      case "chest":
        return Math.min(Math.max(d / 40, 0.26), 0.8);
      case "outlet":
        return Math.min(Math.max(d / 42, 0.4), 1.1);
      case "bounce":
        return Math.min(Math.max(d / 30, 0.32), 0.7);
      case "lob":
        return Math.min(Math.max(d / 26, 0.62), 1.05);
    }
  }

  /**
   * A pass from `i` (holding it) at `t` to `j`, caught where `j` will be
   * then (at `point`): when it's caught. The flight is a crisp line, a
   * bounce off the floor, or a lob over the top to a man in the air.
   */
  pass(i: number, j: number, t: number, point: Point, style: PassStyle, height = 4.4): number {
    const from = this.position(i, t);
    const dir = toward(from, point);
    const start = fieldPoint(along(from, dir, 0.8), style === "lob" ? 7.4 : 4.6);
    const end = fieldPoint(point, height);
    const d = distance(ground(start), point);
    const time = this.passTime(i, t, point, style);
    let how: HoopArc;
    switch (style) {
      case "chest":
        how = arc(0.6 + d * 0.025);
        break;
      case "outlet":
        how = arc(2 + d * 0.06);
        break;
      case "bounce": {
        // Down to the floor two thirds of the way, and up into his hands.
        const n = 24;
        const points: FieldPoint[] = [];
        for (let k = 0; k <= n; k++) {
          const u = k / n;
          const g = { x: start.x + (point.x - start.x) * u, y: start.y + (point.y - start.y) * u };
          const z = u < 0.62 ? start.z * (1 - u / 0.62) : (height * (u - 0.62)) / 0.38 + 1.2 * Math.sin((Math.PI * (u - 0.62)) / 0.38);
          points.push(fieldPoint(g, Math.max(z, 0.4)));
        }
        how = { kind: "samples", points };
        break;
      }
      case "lob":
        how = arc(Math.max(4.5 - (height - start.z) * 0.5, 2.5) + d * 0.05);
        break;
    }
    this.fly(start, end, t, time, how);
    this.act(i, style === "lob" ? "lob" : "pass", t, point);
    this.act(j, "catchBall", t + time, from);
    this.passers.set(j, i);
    if (style !== "lob") this.script.flashes.push({ beat: "catchBall", at: t + time, point: end });
    return t + time;
  }

  /** A shot from `from` at `start` to `to` (the rim's center for a make), leaving the hand at `angle` (radians up from level): an honest parabola, its time set by gravity. */
  shoot(from: FieldPoint, to: FieldPoint, start: number, angle: number): { flight: number; end: number } {
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const dz = to.z - from.z;
    const peak = Math.max((d * Math.tan(angle) - dz) / 4, 0.35);
    const time = Math.sqrt((8 * peak) / G);
    const i = this.fly(from, to, start, time, arc(peak));
    return { flight: i, end: start + time };
  }

  /** The ball through the net at `t`, coming from `way`, then down to the floor and bouncing to rest. */
  throughNet(t: number, way: Point, strength: number): void {
    this.script.score = t;
    this.script.net = { at: t, strength, way };
    const below = fieldPoint(along(RIM, way, 0.3), Hoops.rimHeight - 2.4);
    this.fly(RIM_POINT, below, t, 0.15, STRAIGHT);
    const drift = rotate(way, this.random.in(-0.5, 0.5));
    this.dropToFloor(below, t + 0.15, { x: drift.x * 2.4, y: drift.y * 2.4 }, 12);
  }

  /** A ball falling from `from` at `t`, drifting `drift` ft/s, bouncing twice and coming to rest: the flight's samples (honest physics, the floor taking two fifths of each bounce). */
  dropToFloor(from: FieldPoint, t: number, drift: Point, downward: number, hops = 2): void {
    const points: FieldPoint[] = [];
    let z = from.z;
    let v = -downward;
    let x = from.x;
    let y = from.y;
    let bounces = 0;
    const dt = 1 / 60;
    let elapsed = 0;
    while (bounces <= hops && elapsed < 3) {
      points.push({ x, y, z: Math.max(z, 0.4) });
      v -= G * dt;
      z += v * dt;
      x += drift.x * dt;
      y += drift.y * dt;
      elapsed += dt;
      if (z <= 0.4 && v < 0) {
        z = 0.4;
        v = -v * 0.6;
        bounces += 1;
      }
    }
    const end: FieldPoint = { x, y, z: 0.4 };
    points.push(end);
    const time = (points.length - 1) * dt;
    this.fly(from, end, t, time, { kind: "samples", points });
    this.over = Math.max(this.over, t + time);
    this.script.legs.push({ from: t + time, until: Infinity, hand: { kind: "spot", point: end } });
  }

  /** A miss off the rim at `t` (the front of it, toward the shooter, or the back), up and out to `catchAt` (caught at `height`): when it gets there. */
  rimOut(t: number, shooter: Point, back: boolean, catchAt: Point, height: number): number {
    const o = this.out(shooter);
    const side = back ? negated(o) : o;
    const hit = fieldPoint(along(RIM, side, Hoops.rimRadius), Hoops.rimHeight + 0.15);
    this.script.rimHit = t;
    this.script.rimStrength = 0.35;
    this.script.flashes.push({ beat: "rim", at: t, point: hit });
    const d = distance(ground(hit), catchAt);
    const peak = 2.6 + d * 0.12;
    const time = Math.sqrt((8 * peak) / G) * 0.8 + 0.1;
    this.fly(hit, fieldPoint(catchAt, height), t, time, arc(peak));
    return t + time;
  }

  /** The credited rebounder: of his team (the offense's on an offensive rebound), the one nearest where the ball comes down, the shooter when it's his own; null for a team rebound or one nobody takes. */
  rebounder(rebound: Rebound | null, p: Point, t: number, exclude: ReadonlySet<number>): number | null {
    if (!rebound || rebound.person == null) return null;
    if (rebound.offensive && rebound.person.id != null && rebound.person.id === this.scene?.shooter?.id && !exclude.has(0)) return 0;
    const pool = (rebound.offensive ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9]).filter((k) => !exclude.has(k));
    let best: number | null = null;
    for (const k of pool) if (best == null || distance(this.position(k, t), p) < distance(this.position(best, t), p)) best = k;
    return best;
  }

  /** Where he can get the ball: where it was headed, or as near as he gets by then (17 ft a second). */
  reach(r: number, p: Point, start: number, t: number): Point {
    const here = this.position(r, start);
    const d = distance(here, p);
    const most = Math.max(t - start - 0.15, 0) * 17 + 1.2;
    return d <= most ? p : along(here, toward(here, p), most);
  }

  /** Who ESPN credits, on the figure the play gives him (`credits`). */
  credit(i: number | null | undefined, person: Person | null | undefined): void {
    if (i == null || !person || i >= this.script.players.length || (person.id == null && person.name.length === 0)) return;
    this.script.credits.set(i, person);
  }

  /** He goes up and has it as it gets to him. */
  takeRebound(r: number, point: Point, t: number, start: number): void {
    this.move(r, [along(point, this.out(point), 0.5)], start, Math.max(t - 0.05, start + 0.2), "out");
    this.jump(r, t - 0.25, t, t + 0.3, 1.4);
    this.act(r, "rebound", t, point);
    this.hold(r, t, Infinity);
    this.script.flashes.push({ beat: "catchBall", at: t, point: fieldPoint(point, 8) });
    this.over = Math.max(this.over, t + 0.3);
  }

  // MARK: Build

  build(pace: number = BasketballScript.approachPace): void {
    const scene = this.scene;
    if (!scene) return;
    if (scene.kind === "freeThrow") this.freeThrow();
    else if (scene.steal != null && made(scene)) this.transition();
    else if (scene.kind === "putback") this.putback();
    else this.halfCourt();
    // The shooter, and the man who passed it to him for the assist; a block's blocker.
    const shooter = this.script.shooter;
    this.credit(shooter, scene.shooter);
    if (scene.assister != null) this.credit(shooter != null ? this.passers.get(shooter) : null, scene.assister);
    if (scene.blocker != null) {
      let blocker: number | null = null;
      for (let k = 5; k < this.script.players.length && blocker == null; k++) if (this.script.players[k]!.actions.some((a) => a.kind === "block")) blocker = k;
      this.credit(blocker, scene.blocker);
    }
    this.aftermath();
    // The approach slowed, up to the shooter gathering (his shot's motion begins half a second before it leaves his hand).
    const release = this.script.release;
    if (pace !== 1 && release != null) {
      const lead = this.script.leadIn;
      this.stretch(pace, lead, Math.max(release - 0.55, lead));
    }
    this.finish();
    this.headline();
    this.measureStamp();
    this.settleDown();
    this.shootCamera();
  }

  // MARK: Pace

  /**
   * What's laid out so far, from `a` to `b`, played `k` times slower: every
   * moment in it moved along the slower clock, every one after it moved
   * later by as much; nothing before it changes.
   */
  stretch(k: number, a: number, b: number): void {
    const pace = new Pace(a, Math.max(b, a), k);
    const r = (t: number) => pace.stretched(t);
    const { script } = this;
    for (const p of script.players) {
      p.moves = p.moves.map((m) => new Move(r(m.start), r(m.end), m.path, m.ease));
      p.actions = p.actions.map((x) => ({ ...x, at: r(x.at) }));
      p.jumps = p.jumps.map((j) => new Jump(r(j.from), r(j.peak), r(j.until), j.height, j.hang));
      p.enters = r(p.enters);
      p.leaves = r(p.leaves);
    }
    script.flights = script.flights.map((f) => new HoopFlight(r(f.start), r(f.end), f.from, f.to, f.arc));
    script.legs = script.legs.map((l) => ({ ...l, from: r(l.from), until: r(l.until) }));
    script.flashes = script.flashes.map((f) => ({ ...f, at: r(f.at) }));
    script.net = script.net ? { ...script.net, at: r(script.net.at) } : null;
    script.rimHit = script.rimHit != null ? r(script.rimHit) : null;
    script.score = script.score != null ? r(script.score) : null;
    script.release = script.release != null ? r(script.release) : null;
    script.stamp = r(script.stamp);
    script.look = script.look ? { ...script.look, from: r(script.look.from) } : null;
    this.over = r(this.over);
    this.arrive = r(this.arrive);
  }

  // MARK: The half court

  /** A basket (or a block, or a late miss) out of the half court: the set, the ball to him the way ESPN's type says he got it, his move, the shot and what came of it. */
  halfCourt(): void {
    const scene = this.scene;
    if (!scene?.spot) return;
    const spot = inbounds(Hoops.court(scene.spot));
    const shotKind = scene.shot ?? scene.kind;
    const assisted = scene.assister != null;
    switch (shotKind) {
      case "alleyOop":
        this.alleyOop(spot);
        break;
      case "layup":
      case "dunk":
        if (scene.move === "cut" && assisted) this.cut(spot);
        else this.driveToRim(spot, assisted);
        break;
      default:
        this.jumper(spot, shotKind);
    }
  }

  /**
   * The finish the scene asks for at the rim, for player `i`, coming in
   * along `approach` (out from the rim) and taking off at `t`: a layup off
   * the glass or over the front of the rim, a dunk. Returns the release (or
   * the slam).
   */
  finishAtRim(i: number, approach: Point, t: number, dunk: boolean, hasBall = true): number {
    const scene = this.scene;
    if (!scene) return t;
    if (dunk) {
      // Up off both feet, carried in under the rim; the ball hammered down through it.
      // In to a stride off the rim by the top (his hands over it), then down under it.
      const slam = t + 0.36;
      const hang = posterized(scene) || scene.andOne ? 0.24 : 0.1;
      this.move(i, [along(RIM, approach, 1.7)], t, slam, "out");
      this.move(i, [along(RIM, approach, 0.9)], slam + hang, slam + hang + 0.38, "inOut");
      this.jump(i, t, slam, slam + hang + 0.38, 3.4, hang);
      this.act(i, "dunk", slam, RIM);
      if (hasBall) this.hold(i, this.lastFrom(t), slam - 0.04);
      const hand = fieldPoint(along(RIM, approach, 0.6), Hoops.rimHeight + 0.9);
      if (made(scene)) {
        this.fly(hand, RIM_POINT, slam - 0.04, 0.04, STRAIGHT);
        this.script.rimHit = slam;
        this.script.rimStrength = 1;
        this.throughNet(slam, negated(approach), 1);
      }
      this.script.release = slam - 0.04;
      return slam;
    }
    // The layup: off one foot, the knee up, laid in from the hand at the top of the jump.
    const landing = along(RIM, approach, scene.reverse ? -1.6 : 0.9);
    this.move(i, [landing], t, t + 0.66, "linear");
    const top = t + 0.31;
    this.jump(i, t, top, t + 0.64, 2.3);
    this.act(i, "layup", top, RIM);
    if (hasBall) this.hold(i, this.lastFrom(t), top);
    this.script.release = top;
    const at = this.position(i, top);
    const hand = fieldPoint(along(at, toward(at, RIM), 0.35), 7.05 + 2.3);
    const flight = this.shoot(hand, made(scene) ? RIM_POINT : fieldPoint(along(RIM, approach, 0.7), 10.1), top, 0.95);
    this.arrive = flight.end;
    if (made(scene)) this.throughNet(flight.end, negated(approach), 0.55);
    return top;
  }

  /** `script.legs.last.map { min($0.until, t) } ?? t`. */
  private lastFrom(t: number): number {
    const last = this.script.legs[this.script.legs.length - 1];
    return last ? Math.min(last.until, t) : t;
  }

  /** Off the dribble to the rim: from out top (or off the wing, along the way his spot lies), past his man, the help coming over; or a catch on the move and straight in. */
  driveToRim(spot: Point, assisted: boolean): void {
    const scene = this.scene;
    if (!scene) return;
    const dunk = scene.dunk || scene.shot === "dunk";
    let approach = this.approach(spot);
    if (distance(spot, RIM) < 2.5) {
      // At the rim itself the spot doesn't say the way in: off a wing or straight down the lane.
      approach = rotate({ x: -1, y: 0 }, this.random.in(-0.9, 0.9));
    }
    const start = inbounds(along(RIM, approach, 26));
    const takeoff = along(RIM, approach, dunk ? 5.4 : 4.6);
    const passer = assisted ? 1 : null;
    const passerAt = passer != null ? inbounds(along(RIM, rotate(approach, approach.y >= 0 ? -1.15 : 1.15), 24)) : null;
    this.lineUp([assisted ? along(start, approach, 4) : start, ...(passerAt ? [passerAt] : [])], assisted ? 1 : 0);
    this.script.shooter = 0;
    let t = this.open;
    if (passer != null) {
      // A pass to him on the move, a step inside the arc.
      this.hold(passer, 0, t + 0.25);
      const catchAt = along(RIM, approach, 19);
      this.move(0, [start, catchAt], t - 0.1, t + 0.25 + this.passTime(passer, t + 0.25, catchAt, "chest"), "inOut");
      t = this.pass(passer, 0, t + 0.25, catchAt, "chest");
      this.hold(0, t, t + 0.12);
      this.bounce(0, t + 0.12, Infinity);
      t = this.drive(0, takeoff, t + 0.12, 21, "linear");
    } else {
      this.hold(0, 0, t);
      this.bounce(0, t, Infinity);
      // A hesitation, then downhill.
      t = this.drive(0, takeoff, t + 0.1, 22);
    }
    this.lastLegUntil(t);
    // His man a step behind; the help over from the weak side to meet him.
    const finish = this.finishAtRim(0, approach, t, dunk);
    this.shadow(0, finish + 0.6, new Set([5, 9]));
    this.trail(5, 0, this.open, t + 0.3, negated(approach));
    const helper = 9;
    const meet = along(RIM, rotate(approach, approach.y >= 0 ? -0.5 : 0.5), dunk ? 3.4 : 2.6);
    this.move(helper, [meet], Math.max(t - 0.9, this.open), t - 0.05, "inOut");
    this.contestAtRim(helper, finish, scene.result === "blocked");
    if (scene.result === "blocked") this.blockAtRim(helper, 0, finish, approach);
    else if (!made(scene)) this.rimMiss(this.position(0, finish), this.arrive, new Set([0]));
    if (scene.andOne) this.foulContact(helper, finish);
    this.boxOut(finish);
  }

  /** Off the ball to the rim: a cut along the baseline or down the lane, the pass in (a bounce pass, or a lob over the top), the finish. */
  cut(spot: Point): void {
    const scene = this.scene;
    if (!scene) return;
    const dunk = scene.dunk || scene.shot === "dunk";
    let approach = this.approach(spot);
    // At the rim itself the spot doesn't say the way in: along the baseline from one side or the other.
    if (distance(spot, RIM) < 2.5) approach = { x: -0.35, y: 0.94 * this.random.sign() };
    const start = inbounds(along(RIM, approach, 18));
    const passerAt = inbounds(along(RIM, rotate(approach, approach.y >= 0 ? -1.25 : 1.25), 23));
    this.lineUp([start, passerAt], 1);
    this.script.shooter = 0;
    this.hold(1, 0, this.open + 0.55);
    const catchAt = along(RIM, approach, 8);
    const takeoff = along(RIM, approach, dunk ? 5.2 : 4.4);
    const lands = this.open + 0.55 + this.passTime(1, this.open + 0.55, catchAt, "bounce");
    this.move(0, [catchAt], lands - 0.85, lands, "inOut");
    const caught = this.pass(1, 0, this.open + 0.55, catchAt, "bounce", 4.2);
    this.move(0, [takeoff], caught, caught + 0.2, "linear");
    this.hold(0, caught, Infinity);
    const finish = this.finishAtRim(0, approach, caught + 0.2, dunk, false);
    const last = this.lastHeld(0);
    if (last >= 0) this.script.legs[last]!.until = this.script.release ?? finish;
    this.shadow(0, finish + 0.6, new Set([5, 9]));
    this.trail(5, 0, lands - 0.85, caught + 0.4, negated(approach));
    const meet = along(RIM, rotate(approach, 0.55), 2.8);
    this.move(9, [meet], this.open + 0.4, caught + 0.1);
    this.contestAtRim(9, finish, false);
    if (scene.andOne) this.foulContact(9, finish);
    this.boxOut(finish);
  }

  /** The lob: the passer out top, the cutter from the weak side in stride to the rim, the ball laid up over the defense to where he'll be at the top of his jump, and finished there. */
  alleyOop(spot: Point): void {
    const scene = this.scene;
    if (!scene) return;
    const dunk = scene.dunk;
    let approach = this.approach(spot);
    if (distance(spot, RIM) < 2.5) approach = rotate({ x: -0.45, y: 0.89 }, this.random.heads() ? 0 : -2.2);
    const start = inbounds(along(RIM, approach, 22));
    const passerAt = inbounds(along(RIM, rotate(approach, approach.y >= 0 ? -1.0 : 1.0), 25));
    this.lineUp([start, passerAt], 1);
    this.script.shooter = 0;
    const takeoff = along(RIM, approach, 5.6);
    const t = this.drive(0, takeoff, this.open + 0.1, 21, "inOut");
    const peak = t + 0.38;
    this.move(0, [along(RIM, approach, 2.0)], t, peak, "out");
    this.move(0, [along(RIM, approach, 0.7)], peak + 0.12, peak + 0.55, "inOut");
    this.jump(0, t, peak, peak + (dunk ? 0.5 : 0.36), dunk ? 3.4 : 2.6, dunk ? 0.12 : 0);
    // Caught over his head, a little ahead of him.
    const catchPoint = along(this.position(0, peak), negated(approach), 0.5);
    // The lob leaves so it's there as he is.
    const lobTime = this.passTime(1, peak - 0.8, catchPoint, "lob");
    this.hold(1, 0, peak - lobTime);
    const caught = this.pass(1, 0, peak - lobTime, catchPoint, "lob", Hoops.rimHeight + 1.2);
    this.script.release = caught;
    if (dunk) {
      this.act(0, "dunk", caught + 0.06, RIM);
      this.hold(0, caught, caught + 0.04);
      this.fly(fieldPoint(catchPoint, Hoops.rimHeight + 1.2), RIM_POINT, caught + 0.04, 0.06, STRAIGHT);
      this.script.rimHit = caught + 0.1;
      this.script.rimStrength = 1;
      if (made(scene)) this.throughNet(caught + 0.1, negated(approach), 1);
    } else {
      this.act(0, "layup", caught + 0.05, RIM);
      this.hold(0, caught, caught + 0.08);
      const f = this.shoot(fieldPoint(catchPoint, Hoops.rimHeight + 1.0), RIM_POINT, caught + 0.08, 0.7);
      if (made(scene)) this.throughNet(f.end, negated(approach), 0.6);
    }
    this.shadow(0, peak + 0.6, new Set([5]));
    this.trail(5, 0, this.open + 0.1, t + 0.5, negated(approach));
    this.boxOut(caught);
  }

  /**
   * A jump shot: off the catch (the pass from where an assist comes from on
   * that shot: a kick out of a drive, a swing from the top, an entry to the
   * post) or off the dribble (a pull-up, a step-back, a fadeaway, a floater,
   * a hook), his man closing out to contest.
   */
  jumper(spot: Point, kind: BasketballKind): void {
    const scene = this.scene;
    if (!scene) return;
    const mv = scene.move;
    const assisted = scene.assister != null;
    const o = this.out(spot);
    const d = distance(spot, RIM);
    const lateral = unit({ x: -o.y, y: o.x });
    const side = this.random.sign();
    // Where he starts, by his move.
    let start: Point;
    switch (mv) {
      case "catchAndShoot":
        start = spot.x > 82 ? along(spot, { x: -1, y: 0 }, 1.5) : along(spot, lateral, 5 * side);
        break;
      case "pullUp":
        start = along(along(spot, o, 6), lateral, 8 * side);
        break;
      case "stepBack":
        start = along(spot, o, 9);
        break;
      case "fadeaway":
      case "turnaround":
      case "hook":
        start = along(spot, o, -2.2);
        break;
      case "floater":
        start = along(RIM, rotate(o, 0.3 * side), Math.max(d + 13, 22));
        break;
      default:
        start = along(spot, lateral, 4 * side);
    }
    start = inbounds(start);
    // An assist from where it would come: a drive and kick to the arc, a swing from the top, an entry to the post.
    let passerAt: Point | null = null;
    let drives = false;
    if (assisted) {
      if (kind === "three" && spot.x > 80) {
        passerAt = { x: 70, y: 25 + (spot.y >= 25 ? 9 : -9) };
        drives = true;
      } else if (kind === "three" && Math.abs(spot.y - 25) > 9) {
        passerAt = { x: 62, y: 25 - (spot.y - 25) * 0.25 };
        drives = this.random.heads();
      } else if (kind === "three") {
        passerAt = { x: 84, y: spot.y >= 25 ? 17 : 33 };
      } else if (mv === "hook" || mv === "turnaround" || mv === "fadeaway") {
        passerAt = inbounds(along(start, rotate(o, side * 0.9), 16));
      } else {
        passerAt = inbounds(along(RIM, rotate(o, side * 1.0), 24));
      }
    }
    this.lineUp([start, ...(passerAt ? [passerAt] : [])], assisted ? 1 : 0);
    this.script.shooter = 0;
    let t = this.open;
    let at = spot;
    let lift = 1.5;
    let angle = 0.84;
    let fade = 0;
    if (passerAt && assisted) {
      let leave = t + 0.3;
      this.hold(1, 0, t);
      if (drives) {
        // Into the lane, drawing his man, then out to the shooter.
        this.bounce(1, t, Infinity);
        const lane = along(passerAt, toward(passerAt, RIM), 8);
        leave = this.drive(1, lane, t, 16);
        this.lastLegUntil(leave);
      } else {
        this.hold(1, t, leave);
      }
      const lead = distance(this.position(1, leave), spot) / 40;
      this.move(0, [spot], Math.max(leave - 0.45, this.open), leave + lead + 0.02, "out");
      t = this.pass(1, 0, leave, spot, "chest");
      this.hold(0, t, Infinity);
      if (mv === "hook" || mv === "turnaround" || mv === "fadeaway") {
        // In the post: a beat, the turn, up.
        t += 0.35;
      } else {
        t += 0.22;
      }
    } else {
      this.hold(0, 0, t);
      this.bounce(0, t, Infinity);
      switch (mv) {
        case "stepBack": {
          // At his man, then a hop back to the spot.
          const inside = along(spot, o, -3.2);
          const at1 = this.drive(0, inside, t + 0.05, 15);
          this.move(0, [spot], at1, at1 + 0.26, "out");
          t = at1 + 0.26;
          break;
        }
        case "fadeaway":
        case "turnaround":
        case "hook":
          t += 0.5;
          break;
        case "floater":
          t = this.drive(0, along(spot, o, 2.5), t + 0.05, 18, "linear");
          break;
        default:
          t = this.drive(0, spot, t + 0.05, 15);
      }
      this.lastLegUntil(t);
      this.hold(0, t, Infinity);
      t += mv === "floater" ? 0.02 : 0.12;
    }
    switch (mv) {
      case "fadeaway":
      case "turnaround":
        fade = mv === "fadeaway" ? 2.2 : 0.8;
        lift = 1.6;
        break;
      case "floater":
        lift = 1.1;
        angle = 1.02;
        at = along(spot, o, 0.6);
        break;
      case "hook":
        lift = 0.9;
        angle = 1.0;
        break;
      default:
        lift = kind === "three" ? 1.3 : 1.5;
        angle = d > 18 ? 0.84 : 0.88;
    }
    // Up: the dip, the rise, the release just before the top.
    const takeoff = t + 0.1;
    const airtime = 2 * Math.sqrt((2 * lift) / G);
    const peak = takeoff + airtime / 2;
    const releaseAt = peak - 0.03;
    if (fade > 0) {
      this.move(0, [along(at, o, fade)], takeoff, takeoff + airtime, "linear");
    } else if (mv === "floater") {
      this.move(0, [along(at, o, -2)], takeoff, takeoff + airtime, "linear");
    }
    this.jump(0, takeoff, peak, takeoff + airtime, lift);
    this.act(0, mv === "hook" ? "hook" : "shoot", releaseAt, RIM);
    const held = this.lastHeld(0);
    if (held >= 0) this.script.legs[held]!.until = releaseAt;
    this.script.release = releaseAt;
    const hand = this.release(this.position(0, releaseAt), lift * 0.97);
    const target = made(scene) ? RIM_POINT : fieldPoint(along(RIM, o, 0.7), 10.1);
    const flight = this.shoot(hand, target, releaseAt, angle);
    this.arrive = flight.end;
    // His man: up on him as he catches, a hand up as it goes.
    this.shadow(0, this.arrive + 0.2, new Set([5]));
    const blocked = scene.result === "blocked";
    const contestAt = along(this.position(0, releaseAt), toward(spot, RIM), blocked ? 2.3 : mv === "stepBack" ? 4.6 : 3.2);
    const closeFrom = assisted ? Math.max(t - 0.75, this.open) : this.open;
    this.move(5, [this.guardSpot(this.position(0, closeFrom + 0.3), spot, true), contestAt], closeFrom, releaseAt - 0.02, "out");
    this.contest(5, releaseAt + (blocked ? 0.08 : 0), ground(hand), blocked ? 2.9 : 1.0);
    if (blocked) {
      this.blockShot(5, flight.flight, releaseAt + 0.08);
    } else if (made(scene)) {
      this.throughNet(flight.end, toward(hand, RIM), 0.55);
    } else {
      this.rimMiss(ground(hand), flight.end, new Set());
    }
    this.boxOut(releaseAt);
  }

  // MARK: Putback, transition, the line

  /** A miss and the putback: the first shot off the rim (from where ESPN put it), up to the man under it, and back in: a tip, a putback, a tip dunk. His own miss, he follows it. */
  putback(): void {
    const scene = this.scene;
    if (!scene?.spot) return;
    const finishSpot = Hoops.court(scene.spot);
    const miss: Miss = scene.miss ?? { spot: { x: 25 + this.random.in(-12, 12), y: 24 }, shooter: null, value: 3, close: false };
    const missSpot = inbounds(Hoops.court(miss.spot));
    const own = miss.shooter?.id != null && miss.shooter.id === scene.shooter?.id;
    // The man under it: on the weak side of the shot, a step off the rim.
    const o = this.out(missSpot);
    const weak = inbounds(along(RIM, rotate(negated(o), 0.9 * (o.y >= 0 ? 1 : -1) * 0.6 + Math.PI), 7));
    const under = along(RIM, this.out(distance(finishSpot, RIM) > 1.5 ? finishSpot : weak), 3.2);
    this.lineUp(own ? [missSpot] : [weak, missSpot], own ? 0 : 1);
    this.script.shooter = 0;
    const shooter = own ? 0 : 1;
    if (!own) this.credit(1, miss.shooter);
    const t = this.open;
    this.hold(shooter, 0, t);
    // The first shot.
    let hand: FieldPoint;
    let releaseAt: number;
    if (miss.close) {
      this.bounce(shooter, t, Infinity);
      const takeoff = along(RIM, o, 4.6);
      const at = this.drive(shooter, takeoff, t + 0.05, 18);
      this.lastLegUntil(at);
      this.hold(shooter, at, at + 0.31);
      this.move(shooter, [along(RIM, o, 1.2)], at, at + 0.62, "linear");
      this.jump(shooter, at, at + 0.31, at + 0.62, 2.2);
      this.act(shooter, "layup", at + 0.31, RIM);
      releaseAt = at + 0.31;
      hand = fieldPoint(along(RIM, o, 2.2), 9.3);
    } else {
      this.hold(shooter, t, t + 0.4);
      const lift = miss.value === 3 ? 1.3 : 1.5;
      const takeoff = t + 0.3;
      const airtime = 2 * Math.sqrt((2 * lift) / G);
      this.jump(shooter, takeoff, takeoff + airtime / 2, takeoff + airtime, lift);
      releaseAt = takeoff + airtime / 2 - 0.03;
      this.act(shooter, "shoot", releaseAt, RIM);
      this.lastLegUntil(releaseAt);
      hand = this.release(missSpot, lift);
    }
    const back = this.random.heads();
    const firstFlight = this.shoot(hand, fieldPoint(along(RIM, back ? negated(o) : o, Hoops.rimRadius), 10.15), releaseAt, miss.close ? 0.95 : 0.84);
    // Off the rim, up to him at the top of his jump.
    const tipPoint = along(under, this.out(under), -0.6);
    const up = this.rimOut(firstFlight.end, ground(hand), back, tipPoint, scene.dunk ? 11.2 : 10.6);
    // Under it as it comes off (his own miss: he lands, and goes straight back up for it).
    this.move(0, [along(tipPoint, this.out(tipPoint), 0.45)], own ? releaseAt + 0.35 : releaseAt, up - 0.28, "inOut");
    this.jump(0, up - 0.36, up, up + 0.42, scene.dunk ? 3.2 : 2.6);
    if (scene.dunk) {
      this.act(0, "dunk", up + 0.08, RIM);
      this.hold(0, up, up + 0.05);
      this.fly(fieldPoint(tipPoint, 11.2), RIM_POINT, up + 0.05, 0.07, STRAIGHT);
      this.script.rimHit = up + 0.12;
      this.script.rimStrength = 0.9;
      this.throughNet(up + 0.12, negated(this.out(tipPoint)), 0.95);
    } else {
      this.act(0, "tip", up, RIM);
      const f = this.shoot(fieldPoint(tipPoint, 10.6), RIM_POINT, up, 0.75);
      this.throughNet(f.end, negated(this.out(tipPoint)), 0.5);
    }
    this.script.release = up;
    this.arrive = up;
    this.shadow(0, up + 0.6, new Set([9, 5]));
    // The defenders under it go up too, a beat late.
    this.move(5, [along(under, rotate(this.out(under), 1.2), 2.6)], releaseAt, up - 0.2);
    this.jump(5, up - 0.3, up + 0.05, up + 0.4, 1.6);
    this.act(5, "contest", up, tipPoint);
    this.boxOut(releaseAt);
  }

  /** A steal at the other end and the break: the ball taken where ESPN says, pushed up the floor (ahead to whoever finished it, or his own way), the other team chasing back, and the finish. */
  transition(): void {
    const scene = this.scene;
    const steal = scene?.steal;
    if (!scene?.spot || !steal) return;
    const finishSpot = inbounds(Hoops.court(scene.spot));
    const at = inbounds(steal.spot ? Hoops.otherEnd(steal.spot) : { x: 30, y: 20 + this.random.in(0, 10) });
    const stealerIsShooter = steal.stealer?.id != null && steal.stealer.id === scene.shooter?.id;
    const stealerIsPasser = steal.stealer?.id != null && steal.stealer.id === scene.assister?.id;
    // Their offense (our defense, 5–9) at the far end, the man who lost it on the ball by the steal.
    const farRim = { x: Hoops.length - RIM.x, y: RIM.y };
    const far = (p: Point): Point => ({ x: Hoops.length - p.x, y: Hoops.width - p.y });
    const loserStart = inbounds(along(at, unit({ x: at.x - farRim.x, y: at.y - farRim.y }), 5));
    const spots = [loserStart, far({ x: 72, y: 8 }), far({ x: 72, y: 42 }), far({ x: 89, y: 14 }), far({ x: 64, y: 30 })];
    const theirs = spots.map((p) => {
      const x = p.x + this.random.in(-1.5, 1.5);
      const y = p.y + this.random.in(-1.5, 1.5);
      return inbounds({ x, y });
    });
    for (let k = 1; k < 5; k++) {
      if (distance(theirs[k]!, loserStart) < 7) theirs[k] = inbounds(along(theirs[k]!, { x: 0, y: theirs[k]!.y > 25 ? -1 : 1 }, 8));
    }
    // Ours guarding them, between each man and their rim.
    const guarding = (man: Point, onBall: boolean): Point => inbounds(along(man, toward(man, farRim), onBall ? 3.5 : 7));
    // Which of ours took it: the shooter, the passer, or another.
    const stealer = stealerIsShooter ? 0 : stealerIsPasser ? 1 : 2;
    const ours = theirs.map((p, k) => guarding(p, k === 0));
    [ours[0], ours[stealer]] = [ours[stealer]!, ours[0]!];
    this.script.players = [...ours.map((p) => new Player("offense", p)), ...theirs.map((p) => new Player("defense", p))];
    this.script.shooter = 0;
    const loser = 5;
    this.credit(stealer, steal.stealer);
    this.credit(loser, steal.loser);
    const open = this.open;
    // He has it, going their way; ours jumps the lane and takes it.
    this.hold(loser, 0, open);
    this.bounce(loser, open, open + 0.45);
    this.move(loser, [along(loserStart, toward(loserStart, farRim), 3.5)], open, open + 0.6);
    const takeAt = open + 0.5;
    this.move(stealer, [at], open + 0.05, takeAt, "out");
    this.act(stealer, "steal", takeAt, this.position(loser, takeAt));
    this.fly(fieldPoint(this.position(loser, open + 0.45), 2.5), fieldPoint(at, 3.2), open + 0.45, takeAt - open - 0.45, STRAIGHT);
    this.script.flashes.push({ beat: "steal", at: takeAt, point: fieldPoint(at, 3) });
    // The break.
    this.hold(stealer, takeAt, takeAt + 0.12);
    this.bounce(stealer, takeAt + 0.12, Infinity);
    const dunk = scene.dunk || scene.shot === "dunk";
    const jumpShot = JUMPS.has(scene.shot ?? scene.kind);
    let approach = this.approach(finishSpot);
    if (distance(finishSpot, RIM) < 2.5) approach = rotate({ x: -1, y: 0 }, ((at.y - 25) / 25) * 0.6);
    const takeoff = along(RIM, approach, dunk ? 5.4 : 4.6);
    // Ours run the lanes; theirs sprint back.
    const lanes: Point[] = [
      { x: 70, y: 9 },
      { x: 70, y: 41 },
      { x: 62, y: 25 },
      { x: 58, y: 16 },
      { x: 58, y: 34 },
    ];
    let laneIndex = 0;
    for (let k = 0; k < 5; k++) {
      if (k === stealer || k === 0 || (k === 1 && stealer === 0 && scene.assister != null)) continue;
      this.move(k, [lanes[laneIndex % lanes.length]!], takeAt + 0.1, takeAt + 2.3 + k * 0.15, "inOut");
      laneIndex += 1;
    }
    let t = takeAt + 0.12;
    if (stealer === 0 && scene.assister == null) {
      // His own way, the length of the floor.
      t = this.drive(0, jumpShot ? finishSpot : takeoff, t, 27, "inOut");
    } else {
      // Ahead to whoever runs out with it.
      const receiver = stealer === 0 ? 1 : 0;
      const ahead = jumpShot && receiver === 0 ? finishSpot : inbounds({ x: 66, y: approach.y >= 0 ? 34 : 16 });
      const passAt = this.drive(stealer, along(at, { x: 1, y: 0 }, 12), t, 20, "inOut");
      this.lastLegUntil(passAt);
      this.move(receiver, [ahead], takeAt + 0.1, passAt + distance(this.position(stealer, passAt), ahead) / 42 + 0.05, "inOut");
      t = this.pass(stealer, receiver, passAt, ahead, "outlet");
      if (receiver === 0) {
        this.hold(0, t, jumpShot ? Infinity : t + 0.1);
        if (!jumpShot) {
          this.bounce(0, t + 0.1, Infinity);
          t = this.drive(0, takeoff, t + 0.1, 21, "linear");
        }
      } else {
        // The give and go: back to him going to the rim.
        this.hold(1, t, t + 0.15);
        const catchAt = along(RIM, approach, 10);
        this.move(0, [catchAt], passAt - 0.2, t + 0.15 + distance(this.position(1, t + 0.15), catchAt) / 40, "inOut");
        t = this.pass(1, 0, t + 0.15, catchAt, "chest");
        this.hold(0, t, t + 0.08);
        this.bounce(0, t + 0.08, Infinity);
        t = this.drive(0, takeoff, t + 0.08, 20, "linear");
      }
    }
    for (let i = this.script.legs.length - 1; i >= 0; i--) {
      const h = this.script.legs[i]!.hand;
      if (h.kind === "dribble" && h.player === 0) {
        this.script.legs[i]!.until = t;
        break;
      }
    }
    if (jumpShot) {
      this.hold(0, t, Infinity);
      const lift = scene.shot === "three" ? 1.3 : 1.5;
      const takeoffAt = t + 0.18;
      const airtime = 2 * Math.sqrt((2 * lift) / G);
      this.jump(0, takeoffAt, takeoffAt + airtime / 2, takeoffAt + airtime, lift);
      const releaseAt = takeoffAt + airtime / 2 - 0.03;
      this.act(0, "shoot", releaseAt, RIM);
      const held = this.lastHeld(0);
      if (held >= 0) this.script.legs[held]!.until = releaseAt;
      this.script.release = releaseAt;
      const hand = this.release(finishSpot, lift);
      const f = this.shoot(hand, RIM_POINT, releaseAt, 0.84);
      this.throughNet(f.end, toward(hand, RIM), 0.55);
      this.arrive = f.end;
    } else {
      this.finishAtRim(0, approach, t, dunk, true);
    }
    // Theirs chase back, the man who lost it first; the rest behind the ball.
    const end = (this.script.release ?? t) + 0.4;
    for (let k = 5; k < 10; k++) {
      const goal = k === 5 ? along(RIM, rotate(approach, 0.7), 7) : { x: 66 + (k - 5) * 3, y: 12 + (k - 5) * 7 };
      this.move(k, [inbounds(goal)], takeAt + 0.15 + (k - 5) * 0.05, end - (k - 5) * 0.05 + 0.6, "inOut");
    }
  }

  /** A free throw that tied it or went ahead late: both teams on the lane, the shooter at the line, the routine and the shot. */
  freeThrow(): void {
    const scene = this.scene;
    if (!scene) return;
    const line = { x: Hoops.freeThrow - 0.6, y: 25 };
    const lane: Point[] = [
      { x: 80, y: 33.8 },
      { x: 80, y: 16.2 },
      { x: 66, y: 38 },
      { x: 66, y: 12 },
    ];
    const theirs: Point[] = [
      { x: 64, y: 25 },
      { x: 84, y: 33.8 },
      { x: 84, y: 16.2 },
      { x: 76.5, y: 33.8 },
      { x: 76.5, y: 16.2 },
    ];
    this.script.players = [...[line, ...lane].map((p) => new Player("offense", p)), ...theirs.map((p) => new Player("defense", p))];
    this.script.shooter = 0;
    this.hold(0, 0, 0.55);
    this.bounce(0, 0.55, 1.15);
    this.hold(0, 1.15, 1.75);
    this.act(0, "shoot", 1.75, RIM);
    this.jump(0, 1.6, 1.78, 1.95, 0.25);
    this.script.release = 1.75;
    const hand = this.release(line, 0.2);
    const f = this.shoot(hand, made(scene) ? RIM_POINT : fieldPoint(along(RIM, { x: -1, y: 0 }, 0.7), 10.1), 1.75, 0.9);
    this.arrive = f.end;
    if (made(scene)) this.throughNet(f.end, { x: 1, y: 0 }, 0.5);
    for (let k = 6; k < 10; k++) this.act(k, "boxOut", f.end - 0.2, this.position(k - 5, f.end));
  }

  // MARK: Defense

  /** Beaten off the dribble: from in front of him, round to his hip and a step behind as he goes by (going `way`), chasing. */
  trail(d: number, i: number, start: number, end: number, way: Point): void {
    const side = rotate(way, Math.PI / 2);
    let t = start;
    while (t < end - 0.01) {
      const next = Math.min(t + 0.25, end);
      const him = this.position(i, next);
      const beaten = Rig.smooth((next - start) / 0.7);
      const front = this.guardSpot(him, him, true);
      const hip = along(along(him, way, -1.6), side, 2.2);
      this.move(d, [{ x: front.x + (hip.x - front.x) * beaten, y: front.y + (hip.y - front.y) * beaten }], t, next, "linear");
      t = next;
    }
  }

  /** A hand up at the shot: a closeout's, a little hop. */
  contest(d: number, t: number, p: Point, height: number): void {
    this.act(d, height > 1.6 ? "block" : "contest", t, p);
    this.jump(d, t - 0.22, t + 0.02, t + 0.3, height);
  }

  /** The help at the rim: up with both arms (a block's leap when he gets it). */
  contestAtRim(d: number, t: number, blocker: boolean): void {
    this.act(d, blocker ? "block" : "contest", t, RIM);
    this.jump(d, t - 0.3, t + 0.02, t + 0.42, blocker ? 2.8 : 2.0);
  }

  /** The and-one: the help takes the contact, knocked back a step. */
  foulContact(d: number, t: number): void {
    this.credit(d, this.scene?.fouler);
    const here = this.position(d, t);
    this.move(d, [along(here, this.out(here), 2.2)], t + 0.15, t + 0.6, "out");
  }

  /** A layup or a dunk swatted at the rim: the ball cut off on its way up, sent away. */
  blockAtRim(_d: number, _shooter: number, t: number, approach: Point): void {
    const flights = this.script.flights;
    // The finish's flight (from his hand toward the rim) goes no further than the swat.
    let i = -1;
    for (let k = flights.length - 1; k >= 0; k--) {
      if (flights[k]!.start >= t - 0.06) {
        i = k;
        break;
      }
    }
    if (i >= 0) {
      const f = flights[i]!;
      const at = f.point(f.start + 0.06);
      flights[i] = new HoopFlight(f.start, f.start + 0.06, f.from, at, STRAIGHT);
      const leg = this.lastFlightLeg(i);
      if (leg >= 0) this.script.legs[leg]!.until = f.start + 0.06;
      this.script.legs = this.script.legs.filter((l) => !(l.from > f.start + 0.06));
      flights.splice(i + 1);
      this.script.score = null;
      this.script.net = null;
      this.swat(at, f.start + 0.06, approach);
    } else {
      const at = fieldPoint(along(RIM, approach, 2), 10);
      this.script.legs = this.script.legs.filter((l) => !(l.from > t));
      this.swat(at, t, approach);
    }
  }

  lastFlightLeg(index: number): number {
    for (let k = this.script.legs.length - 1; k >= 0; k--) {
      const h = this.script.legs[k]!.hand;
      if (h.kind === "flight" && h.index === index) return k;
    }
    return -1;
  }

  /** A jump shot blocked just out of his hand. */
  blockShot(_d: number, i: number, t: number): void {
    const flights = this.script.flights;
    const f = flights[i]!;
    const at = f.point(t);
    const points: FieldPoint[] = [];
    for (let k = 0; k <= 8; k++) points.push(f.point(f.start + ((t - f.start) * k) / 8));
    flights[i] = new HoopFlight(f.start, t, f.from, at, { kind: "samples", points });
    const leg = this.lastFlightLeg(i);
    if (leg >= 0) this.script.legs[leg]!.until = t;
    this.script.legs = this.script.legs.filter((l) => !(l.from > t));
    flights.splice(i + 1);
    this.script.score = null;
    this.script.net = null;
    this.swat(at, t, this.out(ground(f.from)));
  }

  /** The swat: away hard and down, to the credited rebounder (or the floor). */
  swat(at: FieldPoint, t: number, shooterSide: Point): void {
    const scene = this.scene;
    if (!scene) return;
    this.script.flashes.push({ beat: "block", at: t, point: at });
    this.arrive = t;
    const away = rotate(shooterSide, this.random.in(-0.7, 0.7));
    const nominal = inbounds(along(ground(at), away, this.random.in(11, 16)));
    const r = this.rebounder(scene.rebound, nominal, t, new Set([0]));
    if (r != null) {
      this.credit(r, scene.rebound?.person);
      const land = this.reach(r, nominal, t + 0.06, t + 0.5);
      const time = Math.min(Math.max(distance(ground(at), land) / 30, 0.3), 0.55);
      this.fly(at, fieldPoint(land, 6), t, time, arc(1.2));
      this.takeRebound(r, land, t + time, t + 0.06);
    } else {
      this.fly(at, fieldPoint(nominal, 2.2), t, 0.48, arc(1.4));
      this.dropToFloor(fieldPoint(nominal, 2.2), t + 0.48, { x: away.x * 6, y: away.y * 6 }, 14);
    }
  }

  /** A miss off the rim to the rebounder (or the floor). */
  rimMiss(shooter: Point, t: number, exclude: ReadonlySet<number>): void {
    const scene = this.scene;
    if (!scene) return;
    const o = this.out(shooter);
    const long = distance(shooter, RIM) > 18;
    const turn = this.random.in(-1.2, 1.2);
    const reachOut = long ? this.random.in(10, 15) : this.random.in(6, 9);
    const nominal = inbounds(along(RIM, rotate(o, turn), reachOut));
    const after = this.script.release ?? t - 1;
    const r = this.rebounder(scene.rebound, nominal, t, exclude);
    if (r != null) {
      this.credit(r, scene.rebound?.person);
      const land = this.reach(r, nominal, after, t + 0.75);
      const caught = this.rimOut(t, shooter, false, land, 8);
      this.takeRebound(r, land, caught, after);
    } else {
      const caught = this.rimOut(t, shooter, false, nominal, 8);
      this.dropToFloor(fieldPoint(nominal, 8), caught, { x: o.x * 4, y: o.y * 4 }, 6);
    }
  }

  /** After a shot goes up, the defense finds the offense's bigs and boxes out. */
  boxOut(t: number): void {
    for (let k = 6; k < 10; k++) {
      if (this.script.players[k]!.actions.length > 0) continue;
      const man = this.position(k - 5, t + 0.4);
      if (!(distance(man, RIM) < 16)) continue;
      const spot = along(man, toward(man, RIM), 2.2);
      this.move(k, [spot], t + 0.05, t + 0.45, "out");
      this.act(k, "boxOut", t + 0.3, man);
    }
  }

  // MARK: End and settle

  /** After the basket: the shooter back down, the offense turning to get back, a defender taking the ball out from under the basket. */
  aftermath(): void {
    const scene = this.scene;
    if (!scene) return;
    this.sortLegs();
    const score = this.script.score;
    if (score == null || !made(scene)) return;
    for (let k = 1; k < 5; k++) {
      const last = this.script.players[k]!.moves.at(-1);
      if (!((last?.end ?? 0) < score + 0.3)) continue;
      const here = this.position(k, score);
      this.move(k, [{ x: here.x - 6, y: here.y + (25 - here.y) * 0.15 }], score + 0.35, score + 1.5, "inOut");
    }
    const b = this.script.ball(score + 1.2);
    if (b) {
      const ball = ground(b);
      let inbounder = 9;
      let best = Infinity;
      for (let k = 5; k < 10; k++) {
        const d = distance(this.position(k, score), ball);
        if (d < best) {
          best = d;
          inbounder = k;
        }
      }
      if (this.script.players[inbounder]!.jumps.every((j) => j.until < score + 0.2)) {
        this.move(inbounder, [inbounds(along(ball, { x: 1, y: 0 }, 1.5))], score + 0.5, score + 1.4, "inOut");
      }
    }
  }

  /** The action ends when the last thing stops; the stamp lands a beat after the net (the block, the rebound). */
  finish(): void {
    if (!this.scene) return;
    this.sortLegs();
    const script = this.script;
    const block = script.flashes.find((f) => f.beat === "block");
    if (script.score != null) script.stamp = script.score + 0.18;
    else if (block) script.stamp = block.at + 0.35;
    else script.stamp = Math.max(this.arrive + 0.3, this.open + 0.6);
    const hold = 0.35;
    const flashes = script.flashes.map((f) => f.at);
    const ends = [script.stamp + hold + 0.4, Math.min(this.over, script.stamp + 1.0), (flashes.length > 0 ? Math.max(...flashes) : 0) + 0.4];
    script.settle = Math.max(Math.max(...ends), 1.5) + hold;
  }

  /** The headline for a marquee play, landing with its payoff. */
  headline(): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const banner = (text: string, tone: Banner["tone"], at: number, confetti = false) => {
      script.banner = { text, tone, at, until: Math.max(script.settle, at + 1.5), confetti };
    };
    const block = script.flashes.find((f) => f.beat === "block");
    if (scene.result === "blocked" && block) {
      banner("REJECTED", { kind: "side", side: defense(scene) }, block.at + 0.04);
      return;
    }
    const at = script.score;
    if (!made(scene) || at == null) return;
    const side = { kind: "side", side: scene.offense } as const;
    if (scene.buzzer) banner("BUZZER-BEATER", scene.decisive ? { kind: "gold" } : side, at, true);
    else if (posterized(scene)) banner("POSTERIZED", side, at);
    else if (scene.andOne) banner("AND-ONE", side, at + 0.1);
    else if (scene.dunk) banner("DUNK", side, at);
  }

  /**
   * The stamp's corner, measured from its type as the frame sets it: the
   * number at a fifth of the view's height; the lines under it at about an
   * eighteenth, narrowed to fit under 44% of the width; in a view twice as
   * wide as tall.
   */
  measureStamp(): void {
    const scene = this.scene;
    if (!scene) return;
    const stamp = basketballStamp(scene);
    let code = 0;
    for (const part of stamp.parts) {
      let width = 0;
      for (const c of part.text) width += /\p{N}/u.test(c) ? 0.6 : c === "+" ? 0.62 : 0.7;
      code += width * (part.heavy ? 1 : 0.42) + 0.16;
    }
    const number = (0.055 + code * 0.2) / CameraFrame.aspect;
    const longest = stamp.lines.reduce((m, l) => Math.max(m, [...l].length), 0);
    const line = Math.min((longest * 0.66 * 0.056) / CameraFrame.aspect, 0.44) + 0.03;
    this.script.corner = { width: Math.max(number, line) + 0.03, height: 0.27 + 0.065 * stamp.lines.length };
  }

  /** After the hold everyone stays where it ended (BasketballScript.Builder.settle). */
  settleDown(): void {
    this.script.duration = this.script.settle + 0.3;
  }

  // MARK: Camera

  /** Cuts the play into shots: the set in the half court; each pass with the man it goes to; the shot with the shooter and the rim; the finish tight on the rim; then where it ended (BasketballScript.Builder.shoot). */
  shootCamera(): void {
    const script = this.script;
    const everyone = script.players.map((_, i) => i);
    const shots: Shot[] = [shot(0, { actors: everyone, points: [RIM_POINT], closest: 38, at: 0 })];
    const steal = script.flashes.find((f) => f.beat === "steal");
    if (steal) {
      // The steal: the two of them; then the break, with the man who has it and the rim ahead.
      let near = 0;
      let best = Infinity;
      script.players.forEach((_, i) => {
        const d = distance(this.position(i, steal.at), ground(steal.point));
        if (d < best) {
          best = d;
          near = i;
        }
      });
      shots[0] = shot(0, { actors: [5, near], points: [steal.point], closest: 32 });
      shots.push(shot(steal.at + 0.35, { actors: [0], points: [RIM_POINT], closest: 40, carrier: true }));
    }
    const release = script.release ?? 0;
    // The passes (not the shot): each with the man it goes to.
    script.flights.forEach((f, i) => {
      if (!(f.start > this.open && f.start < release - 0.05 && f.end - f.start > 0.25)) return;
      let near: number | null = null;
      let best = Infinity;
      script.players.forEach((_, k) => {
        const d = distance(this.position(k, f.end), ground(f.to));
        if (d < best) {
          best = d;
          near = k;
        }
      });
      shots.push(shot(Math.max(f.start - 0.25, (shots.at(-1)?.from ?? 0) + 0.3), { flight: i, actors: near != null ? [near] : [], points: [RIM_POINT], closest: 32 }));
    });
    // The shot: the shooter, the ball and the rim; the finish tight on it.
    if (script.shooter != null) {
      const from = Math.max(release - 0.5, (shots.at(-1)?.from ?? 0) + 0.3);
      const index = script.flights.findIndex((f) => f.start >= release - 0.06 && f.start <= release + 0.1);
      shots.push(shot(from, { flight: index >= 0 ? index : null, actors: [script.shooter], points: [RIM_POINT], closest: 28 }));
    }
    // The end: the rim, the shooter, where the ball went.
    const ending: FieldPoint[] = [RIM_POINT];
    const ball = script.ball(script.settle);
    if (ball) ending.push(fieldPoint(ground(ball)));
    const endFrom = Math.min(Math.max(script.stamp - 0.35, (shots.at(-1)?.from ?? 0) + 0.3), script.settle - 0.2);
    shots.push(shot(endFrom, { actors: script.shooter != null ? [script.shooter] : [], points: ending, closest: 30 }));
    script.shots = shots;

    const banner: readonly [number, number] | null = script.banner ? [script.banner.at, script.banner.until] : null;
    const corner = { width: script.corner.width + 0.03, height: script.corner.height + 0.04 };
    const stamp = script.stamp;
    const restRegion = this.restRegion();
    const goal = (t: number): CameraFrame => {
      let k = 0;
      for (let i = shots.length - 1; i >= 0; i--) {
        if (shots[i]!.from <= t) {
          k = i;
          break;
        }
      }
      const s = shots[k]!;
      let items = shotRegion(s, script, t);
      let region = unionAll(items) ?? restRegion;
      let closest = s.closest;
      if (k > 0 && !s.cut) {
        const before = shotRegion(shots[k - 1]!, script, t);
        const a = unionAll(before);
        if (a) {
          const blend = CameraRig.blend(a, region, t - s.from);
          if (blend.u < 1) {
            region = blend.region;
            closest = shots[k - 1]!.closest + (closest - shots[k - 1]!.closest) * blend.u;
            items = [...items, ...before];
          }
        }
      }
      const headroom = CameraRig.headroom(t, banner);
      if (!(Number.isFinite(stamp) && t >= stamp - 0.3)) return fitting(region, headroom, closest, Hoops.tightest);
      const others: Rect[] = [];
      for (const p of script.players) for (const at of [t, t + 0.4]) others.push(script.room(fieldPoint(p.position(at)), true));
      if (!(t > script.settle)) return clearing(region, items, others, headroom, closest, corner, Hoops.tightest);
      return clearing(
        restRegion,
        others.filter((r) => intersects(restRegion, r)),
        others,
        headroom,
        32,
        corner,
        Hoops.tightest,
      );
    };
    const rest = this.restFrame();
    const followed = script.duration;
    const samples = CameraRig.follow(followed, goal);
    const last = samples.at(-1) ?? rest;
    const pan = Math.hypot(last.x - rest.x, last.y - rest.y) / Math.min(last.span, rest.span);
    const zoom = Math.log(rest.span / last.span);
    const glide = Math.max(0.4, (1.5 * pan) / 1.25, (1.5 * Math.abs(zoom)) / (zoom > 0 ? 2 : 1));
    script.duration = Math.max(followed + glide, (script.banner?.until ?? 0) + 0.3);
    script.camera = new CameraPath(rest, samples, followed, followed + glide);
  }

  /** What the camera rests on: the rim and everyone near the end of it. */
  restRegion(): Rect {
    const script = this.script;
    const t = script.settle + 2;
    const rim = script.room(RIM_POINT, false);
    const items = script.players.map((p) => script.room(fieldPoint(p.position(t)), true)).filter((r) => Math.abs(midX(r) - midX(rim)) < 34);
    items.push(rim);
    const ball = script.ball(t);
    if (ball) items.push(script.room(fieldPoint(ground(ball)), false));
    return unionAll(items)!;
  }

  restFrame(): CameraFrame {
    const script = this.script;
    const t = script.settle + 2;
    const region = this.restRegion();
    const items = script.players.map((p) => script.room(fieldPoint(p.position(t)), true));
    return clearing(
      region,
      items.filter((r) => intersects(region, r)),
      items,
      CameraFrame.headroom,
      32,
      script.corner,
      Hoops.tightest,
    );
  }
}

// MARK: - Shots

/** One shot of the broadcast: from when, and what it keeps in frame. */
export interface Shot {
  readonly from: number;
  /** A flight's ball, now and a beat ahead. */
  readonly flight: number | null;
  /** Players by index, now and a beat ahead. */
  readonly actors: readonly number[];
  /** Fixed spots: the rim. */
  readonly points: readonly FieldPoint[];
  /** No closer than this (feet top to bottom). */
  readonly closest: number;
  readonly cut: boolean;
  /** Players framed where they stood at this moment (the set), not as they move. */
  readonly at: number | null;
  /** Whoever has the ball, too. */
  readonly carrier: boolean;
}

export function shot(from: number, options: Partial<Omit<Shot, "from">> = {}): Shot {
  return { from, flight: null, actors: [], points: [], closest: 48, cut: false, at: null, carrier: false, ...options };
}

/** What a shot keeps in frame at t: each figure's or ball's room. */
export function shotRegion(s: Shot, script: BasketballScript, t: number): Rect[] {
  const items = s.points.map((p) => script.room(p, false));
  if (s.flight != null && s.flight < script.flights.length) {
    const f = script.flights[s.flight]!;
    for (const dt of [0, 0.2, 0.45]) {
      const p = f.point(Math.min(Math.max(t + dt, f.start), f.end));
      items.push(script.room(p, false));
      items.push(script.room(fieldPoint(ground(p)), false));
    }
  }
  const people = [...s.actors];
  if (s.carrier) {
    const c = script.carrier(t);
    if (c) people.push(c.player);
  }
  for (const index of people) {
    const player = script.players[index];
    if (!player) continue;
    if (s.at != null) {
      items.push(script.room(fieldPoint(player.position(s.at)), true));
      continue;
    }
    for (const dt of [0, 0.25]) items.push(script.room(fieldPoint(player.position(t + dt), player.lift(t + dt)), true));
  }
  if (s.carrier) {
    const ball = script.ball(t + 0.3);
    if (ball) items.push(script.room(ball, false));
  }
  return items;
}

// MARK: - Stamp

export interface StampPart {
  readonly text: string;
  readonly heavy: boolean;
}

/**
 * The stamp for a play, low on the left as it resolves, in the box score's
 * own words: the points heavy in the scoring team's color ("+3"), "BLK" in
 * the blocker's, "MISS"; the shot under it as the play-by-play names it
 * ("BROWN JR. · 23 FT JUMP SHOT"), then the assist, the steal, the rebound
 * ("AST ELLIS", "STL DEMIN", "REB HAUSER"). Between the shots, a rebound's
 * "REB", a steal's "STL", a turnover's "TO". Tones: `score` the shooting
 * team's color (a basket), `block` the blocking team's. (pure; tested)
 */
export interface BasketballStamp {
  readonly parts: readonly StampPart[];
  /** The lines under the number, each in small capitals. */
  readonly lines: readonly string[];
  readonly tone: "score" | "block" | "neutral";
}

export function basketballStamp(scene: BasketballScene): BasketballStamp {
  const shooter = scene.shooter?.name.toUpperCase() ?? "";
  const line = (...words: (string | null | undefined)[]) => words.filter((w): w is string => w != null && w !== "").join(" · ");
  // The ball plays between the shots: a rebound, a steal, a turnover in the open floor. A whistle has its tag, not a stamp.
  switch (scene.kind) {
    case "offensiveRebound":
    case "defensiveRebound":
      return {
        parts: [{ text: "REB", heavy: true }],
        lines: [line(shooter === "" ? "TEAM" : shooter, scene.kind === "offensiveRebound" ? "OFFENSIVE REBOUND" : "DEFENSIVE REBOUND")].filter((l) => l !== ""),
        tone: "score",
      };
    case "steal":
    case "turnover": {
      const what = typeCallWords(scene.typeText);
      const stealer = scene.steal?.stealer?.name;
      if (stealer && scene.kind === "steal") return { parts: [{ text: "STL", heavy: true }], lines: [stealer.toUpperCase(), line(shooter, what)].filter((l) => l !== ""), tone: "block" };
      return { parts: [{ text: "TO", heavy: true }], lines: [line(shooter, what)].filter((l) => l !== ""), tone: "neutral" };
    }
    case "foul":
    case "violation":
    case "jumpBall":
    case "substitution":
    case "timeout":
    case "periodEnd":
    case "challenge":
      return { parts: [], lines: [], tone: "neutral" };
    default:
      break;
  }
  // The shot as ESPN's play-by-play names it, with its distance from 4 ft out.
  const name = scene.typeText.toUpperCase().replaceAll(" - ", " ");
  const feet = scene.distance != null && scene.distance >= 4 && scene.kind !== "freeThrow" ? `${Math.trunc(scene.distance)} FT` : null;
  const shotName = [feet, name === "" ? null : name].filter((x): x is string => x != null).join(" ");
  const credits: string[] = [];
  const assist = scene.assister?.name;
  if (assist) credits.push(`AST ${assist.toUpperCase()}`);
  const stealer = scene.steal?.stealer?.name;
  if (stealer && made(scene)) credits.push(`STL ${stealer.toUpperCase()}`);
  let parts: StampPart[];
  let lines: string[];
  let tone: BasketballStamp["tone"] = "neutral";
  switch (scene.result) {
    case "make":
      parts = [{ text: `+${scene.points}`, heavy: true }];
      if (scene.kind === "freeThrow") parts.push({ text: "FT", heavy: false });
      else if (scene.value === 3) parts.push({ text: "3PT", heavy: false });
      tone = "score";
      lines = [line(shooter, shotName)];
      break;
    case "blocked":
      parts = [{ text: "BLK", heavy: true }];
      tone = "block";
      lines = [scene.blocker?.name.toUpperCase() ?? "", line(shooter, shotName)];
      break;
    case "miss": {
      parts = [{ text: "MISS", heavy: true }];
      if (scene.value === 3) parts.push({ text: "3PT", heavy: false });
      lines = [line(shooter, shotName)];
      const r = scene.rebound?.person?.name;
      if (r) credits.push(`REB ${r.toUpperCase()}`);
      break;
    }
  }
  if (credits.length > 0) lines.push(credits.join(" · "));
  return { parts, lines: lines.filter((l) => l !== ""), tone };
}

