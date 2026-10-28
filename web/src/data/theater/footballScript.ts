/**
 * The football theater's choreography (FootballScript.swift): a
 * `FootballScene` turned into every player's path, the ball's flights and
 * carries, the beats (the catch, the hit, the flag), the lines on the field
 * and the camera's shots, in feet and seconds from the start of the replay.
 * Built once per play; any frame is a pure function of the script and t, so
 * the harness can draw t = 2.1 without playing 0…2.1, and the tests can
 * check that a pass reaches its receiver where ESPN says it was caught.
 *
 * The field is drawn from behind the offense, as a broadcast's end-zone
 * camera sees it: x across (the offense's right is +), y downfield from its
 * own goal line, z up. The offense lines up as the play says (in the gun or
 * under center, heavy, empty, a bunch, the punt and field-goal units, the
 * kickoff), round the ball on its hash. Time is a replay's: the snap after
 * half a second on the formation, everything after it about one and a half
 * times the game's speed, so a snap runs 2–5 s, and the stamp holds a third
 * of a second on it. Then the field settles: on a new down the two teams jog
 * back to the new line; after a score, a kick or a turnover they hold where
 * it ended. A touchdown's try is a scene of its own, a shorter beat.
 *
 * The play is told in the order it happened, by the men ESPN credits: the
 * defense in its own base front, each man in his depth-chart slot; the rush
 * that got home as he threw; the strip, the scramble for the ball and who
 * came up with it, then the return; the kick blocked at the line; each flag
 * thrown by the nearest official when and where its foul happened, and the
 * yards walked off after.
 *
 *     const script = FootballScript.play(scene);
 *     script.ball(2.1); script.camera.frame(2.1);
 */
import { CameraFrame, type Rect } from "../mlb/playCamera";
import { Flight, Move, type Arc } from "../mlb/playScript";
import { easeValue, fieldPoint, ground, type Ease, type FieldPoint, type Point } from "../mlb/theaterField";
import type { Side } from "../models";
import { DepthSlot, kindIs, playText, rounded, type Flag as SceneFlag, type FootballScene, type Lane, type Participant, type Position } from "./footballScene";
import { ballMemo, RigTrack, type RigFacing } from "./rig";
import { CameraPath, CameraRig, clearing, intersects, maxY, midX, unionAll } from "./theaterKit";

// MARK: - The field

const YAW = (30 * Math.PI) / 180;

/** The field in feet, in the offense's frame: its own goal line at y = 0, the one it attacks at 300, the sidelines at x = ±80. */
export const Gridiron = {
  yard: 3,
  half: 80,
  endZone: 30,
  /** The inbound lines (hash marks): 70 ft 9 in from each sideline. */
  hash: 9.25,
  /** The yard numbers' centers across: about 10 yards in from the sidelines. */
  numbers: 50,
  crossbar: 10,
  /** The uprights: 18 ft 6 in apart, 35 ft above the crossbar. */
  upright: 9.25,
  uprightTop: 45,
  /** The goalposts stand on the end lines. */
  backLine: 330,

  y(yard: number): number {
    return yard * 3;
  },

  /** Where the ball sits across the field on a hash: on the marks, 18 ft 6 in apart. */
  spot(hash: Lane): number {
    return hash === "left" ? -(9.25 - 1) : hash === "right" ? 9.25 - 1 : 0;
  },

  /**
   * The camera's yaw: the field turned a third of the way round, so the
   * offense attacks up and to the right and the field reads in depth
   * (straight from behind, a squashed rectangle reads flat). A kick at the
   * posts is shot straight from behind, as broadcasts do, so its line
   * through (or past) the uprights is plain.
   */
  yaw: YAW,

  /** A point on the field as the camera's projection takes it (x across the view, y into it). */
  view(p: Point, yaw: number = YAW): Point {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return { x: p.x * c + p.y * s, y: -p.x * s + p.y * c };
  },

  viewField(p: FieldPoint, yaw: number = YAW): FieldPoint {
    return fieldPoint(Gridiron.view(p, yaw), p.z);
  },

  /** The room the camera keeps round a spot on the field. */
  room(p: FieldPoint, figure: boolean, yaw: number = YAW): Rect {
    return CameraRig.room(Gridiron.viewField(p, yaw), figure);
  },
};

// MARK: - Script

/** The two teams, and the official who throws a flag. */
export type Team = "offense" | "defense" | "official";

/** Who he is on the play: his stance and pose follow from it. */
export type Role = "line" | "quarterback" | "back" | "receiver" | "tightEnd" | "front" | "backer" | "corner" | "safety" | "kicker" | "holder" | "punter" | "returner" | "cover" | "official";

/**
 * A moment of the play in his hands: besides the catch, the throw, the kick,
 * the tackle and the block, a punch at the ball in another man's arms (the
 * `strip`), laid out on the grass for a loose ball (`scramble`), an
 * official's flag thrown (`flagThrow`), up off the line with both arms high
 * for a kick (`leap`).
 */
export interface Action {
  readonly kind: "catchHigh" | "catchChest" | "throwBall" | "handoff" | "kick" | "tackle" | "block" | "spike" | "scoop" | "strip" | "scramble" | "flagThrow" | "leap";
  readonly at: number;
  /** Where the ball comes from or goes: he turns to face it. */
  readonly toward: Point;
}

/** A pose held from a moment on: on a knee, down after the tackle, both arms up in the end zone, a hand up for the fair catch, on his back after a hit as he threw. */
export interface Hold {
  readonly kind: "kneel" | "down" | "touchdown" | "fairCatch" | "knocked";
  readonly from: number;
  readonly until: number;
}

export class Player {
  static readonly fade = 0.3;

  team: Team;
  at: Point;
  role: Role;
  /** The depth-chart slot he lines up in ("lde", "rcb", "ss", "lt"): a credited man is this man, on this side. */
  key: string | null = null;
  moves: Move[] = [];
  actions: Action[] = [];
  holds: Hold[] = [];
  /** In his stance until the snap, and again once he's set at the new line. */
  set: number | null;
  resets: number | null = null;
  appear = -Infinity;
  vanish = Infinity;

  constructor(team: Team, at: Point, role: Role, set: number | null = null) {
    this.team = team;
    this.at = at;
    this.role = role;
    this.set = set;
  }

  private current(t: number): Move | undefined {
    for (let i = this.moves.length - 1; i >= 0; i--) if (t >= this.moves[i]!.start) return this.moves[i];
    return undefined;
  }

  /** The newest move that has begun wins: a later move starts from wherever the one before had got to. */
  position(t: number): Point {
    const move = this.current(t);
    if (!move) return this.at;
    return t < move.end ? move.point(t) : (move.path[move.path.length - 1] ?? this.at);
  }

  opacity(t: number): number {
    const fadeIn = Number.isFinite(this.appear) ? Math.min(Math.max((t - this.appear) / Player.fade, 0), 1) : 1;
    const fadeOut = Number.isFinite(this.vanish) ? 1 - Math.min(Math.max((t - this.vanish) / Player.fade, 0), 1) : 1;
    return fadeIn * fadeOut;
  }

  /** Feet a second along the ground at t, and which way (null: standing). */
  motion(t: number): { speed: number; heading: Point } | null {
    const move = this.current(t);
    if (!move || !(t < move.end) || !(move.length > 0.5)) return null;
    const t0 = Math.max(t - 0.02, move.start);
    const t1 = Math.min(t + 0.02, move.end);
    const a = move.point(t0);
    const b = move.point(t1);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const dt = t1 - t0;
    if (!(d > 0.01) || !(dt > 0)) return null;
    return { speed: d / dt, heading: { x: (b.x - a.x) / d, y: (b.y - a.y) / d } };
  }

  hold(t: number): Hold | null {
    for (let i = this.holds.length - 1; i >= 0; i--) {
      const h = this.holds[i]!;
      if (t >= h.from && (t < h.until || !Number.isFinite(h.until))) return h;
    }
    return null;
  }

  inStance(t: number): boolean {
    return (this.set != null && t < this.set) || (this.resets != null && t >= this.resets);
  }

  act(kind: Action["kind"], at: number, toward: Point): void {
    this.actions.push({ kind, at, toward });
  }

  move(path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    this.moves = this.moves.filter((m) => m.start < start);
    const origin = this.position(start);
    const last = path[path.length - 1];
    if (!last || !(Math.hypot(last.x - origin.x, last.y - origin.y) > 0.5 || path.length > 1)) return;
    this.moves.push(new Move(start, Math.max(end, start + 0.05), [origin, ...path], ease));
  }
}

/** Where the ball is, leg by leg: in the air, in someone's hands, on the ground. */
export interface Leg {
  readonly from: number;
  readonly until: number;
  readonly hand:
    | { readonly kind: "flight"; readonly index: number }
    | { readonly kind: "carry"; readonly player: number }
    | { readonly kind: "spot"; readonly point: FieldPoint }
    /** Slid along the ground between two spots (a flag's yards walked off). */
    | { readonly kind: "slide"; readonly from: FieldPoint; readonly to: FieldPoint };
}

export type Beat = "snap" | "kick" | "catchBall" | "hit" | "deflect" | "flag";

export interface Flash {
  readonly beat: Beat;
  readonly at: number;
  readonly point: FieldPoint;
}

/** The broadcast's lines: the line of scrimmage (blue) and the line to gain (yellow), in feet down the field; null: not drawn. */
export interface Lines {
  readonly scrimmage: number | null;
  readonly gain: number | null;
}

const NO_LINES: Lines = { scrimmage: null, gain: null };

/** A flag thrown in: from where, to where, when it lands; a declined one says so beside it once the play is over. */
export interface Flag {
  readonly thrown: number;
  readonly lands: number;
  readonly from: FieldPoint;
  readonly to: Point;
  readonly declined: boolean;
}

/** A flag's yards walked off: the spot moves from one line to another. */
export interface March {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly end: number;
}

/**
 * The headline across the top for a marquee play: TOUCHDOWN, FIELD GOAL,
 * INTERCEPTION. It lands with the payoff and clears as the field settles.
 * Tones: a team's own color (its score), neutral ink (turnovers and
 * misses), gold (a game-winner).
 */
export interface Banner {
  readonly text: string;
  readonly tone: { readonly kind: "side"; readonly side: Side | null } | { readonly kind: "neutral" } | { readonly kind: "gold" };
  readonly at: number;
  readonly until: number;
  /** It brings its own confetti (a touchdown). */
  readonly confetti: boolean;
}

/** Between plays with nothing replayed: the offense set at its line. */
export interface Rest {
  /** Yards from the offense's own goal line. */
  readonly yard: number;
  readonly gain: number | null;
}

export class FootballScript {
  players: Player[] = [];
  flights: Flight[] = [];
  legs: Leg[] = [];
  flashes: Flash[] = [];
  /** The lines through the snap, and after the play (they move at `linesMove`). */
  lines: Lines = NO_LINES;
  next: Lines = NO_LINES;
  linesMove = Infinity;
  /** Every flag on the play, in the order they're thrown. */
  flags: Flag[] = [];
  march: March | null = null;
  banner: Banner | null = null;
  /** When the stamp lands. */
  stamp = Infinity;
  /** The touchdown's moment (the ball crossing the goal line) or the kick's (crossing the crossbar), and where: the celebration's. */
  score: number | null = null;
  scorePoint: FieldPoint | null = null;
  /** Where the play ended: the end spot. */
  end: FieldPoint | null = null;
  settle = 0;
  duration = 0;
  /** The stamp's corner of the view (bottom left), as fractions of its width and height: the camera keeps the play out of it. */
  corner = { width: 0, height: 0 };
  shots: Shot[] = [];
  camera = new CameraPath({ x: 0, y: 60, span: 80 });
  yaw = Gridiron.yaw;
  /** The ball is put away from here (a kick that's through the posts). */
  ballGone = Infinity;
  /** Each player's motion through the replay (his heading, stride and footfalls), measured once: by player. */
  rig: RigTrack[] = [];

  /** The room the camera keeps round a spot, at this script's yaw. */
  room(p: FieldPoint, figure: boolean): Rect {
    return Gridiron.room(p, figure, this.yaw);
  }

  /** The first flag thrown. */
  get flag(): Flag | null {
    return this.flags[0] ?? null;
  }

  /** The ball at t: in the air, in hand, on the ground. */
  ball(t: number): FieldPoint | null {
    const first = this.legs[0];
    if (!first || (Number.isFinite(this.ballGone) && t >= this.ballGone)) return null;
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
      case "carry": {
        const p = this.players[hand.player];
        return p ? fieldPoint(p.position(at), 3.4) : null;
      }
      case "spot":
        return hand.point;
      case "slide": {
        const u = easeValue("inOut", leg.until > leg.from ? (at - leg.from) / (leg.until - leg.from) : 1);
        return { x: hand.from.x + (hand.to.x - hand.from.x) * u, y: hand.from.y + (hand.to.y - hand.from.y) * u, z: hand.from.z };
      }
    }
  }

  /** Who has the ball in his hands at t (as `ball` has it), since when, and until when it leaves them (∞: it never does). */
  carrier(t: number): { readonly player: number; readonly from: number; readonly until: number } | null {
    for (let i = this.legs.length - 1; i >= 0; i--) {
      const leg = this.legs[i]!;
      if (!(t >= leg.from)) continue;
      return leg.hand.kind === "carry" ? { player: leg.hand.player, from: leg.from, until: i + 1 < this.legs.length ? leg.until : Infinity } : null;
    }
    return null;
  }

  /** The ball's flight at t, when it's in the air. */
  flight(t: number): Flight | null {
    for (let i = this.legs.length - 1; i >= 0; i--) {
      const leg = this.legs[i]!;
      if (!(t >= leg.from)) continue;
      if (!(t <= leg.until) || leg.hand.kind !== "flight") return null;
      return this.flights[leg.hand.index] ?? null;
    }
    return null;
  }

  /** A line at t: where it is, and how strongly it's drawn (it fades in or out when there's a line on only one side of the move). */
  static line(a: number | null, b: number | null, u: number): { y: number; opacity: number } | null {
    if (a != null && b != null) return { y: a + (b - a) * u, opacity: 1 };
    if (a != null) return u < 1 ? { y: a, opacity: 1 - u } : null;
    if (b != null) return u > 0 ? { y: b, opacity: u } : null;
    return null;
  }

  /** How far the lines have moved at t (0 to 1, eased). */
  linesProgress(t: number): number {
    if (!Number.isFinite(this.linesMove)) return 0;
    return easeValue("inOut", (t - this.linesMove) / 0.45);
  }

  // MARK: - Building

  /** Between plays with nothing replayed: the offense set at its line. */
  static rest(rest: Rest): FootballScript {
    const b = new Builder(null, Gridiron.y(rest.yard), true);
    b.scrimmage();
    for (const p of b.script.players) if (p.set != null) p.resets = 0;
    b.script.lines = { scrimmage: Gridiron.y(rest.yard), gain: rest.gain != null ? Gridiron.y(rest.gain) : null };
    b.script.next = b.script.lines;
    b.script.legs = [{ from: 0, until: 0, hand: { kind: "spot", point: { x: 0, y: Gridiron.y(rest.yard), z: 0.6 } } }];
    b.script.camera = new CameraPath(b.restFrame());
    b.script.measureBodies();
    return b.script;
  }

  static play(scene: FootballScene): FootballScript {
    const b = new Builder(FootballScript.played(scene) ?? scene, Gridiron.y(scene.from), scene.shotgun, scene);
    b.build();
    b.script.measureBodies();
    return b.script;
  }

  /**
   * A snap a flag wiped out ("… - No Play"), as it was run before the flag
   * came back: ESPN types it a penalty, but its words say what happened (a
   * pass, a run, a sack) and where he was stopped. Null for a flag that
   * stopped the snap, or a play the words don't name. (pure; tested)
   */
  static played(scene: FootballScene): FootballScene | null {
    if (scene.kind.type !== "penalty" || scene.flags.some((f) => f.timing === "beforeSnap" && f.status === "accepted")) return null;
    const words = playText(scene.text).toLowerCase();
    let kind: FootballScene["kind"];
    if (words.includes("sacked")) kind = { type: "sack" };
    else if (words.includes("kneels") || words.includes("kneel down")) kind = { type: "kneel" };
    else if (words.includes(" pass ") || words.startsWith("pass ")) kind = { type: words.includes("incomplete") ? "incomplete" : "pass" };
    else if (words.includes(" rush") || words.includes("scrambles") || scene.gap != null || words.includes(" up the middle")) kind = { type: "rush" };
    else return null;
    const played = scene.clone();
    played.kind = kind;
    played.to = scene.stopped ?? scene.from;
    played.scoring = null;
    played.flips = false;
    played.onDowns = false;
    played.penalty = null;
    played.flags = [];
    played.stopped = null;
    // The depth the words give, at the medians caught passes are thrown to (5 yards short, 20 deep).
    if (kind.type === "pass" || kind.type === "incomplete") {
      const gain = played.to - scene.from;
      played.air = kind.type === "pass" ? Math.min(gain, scene.depth === "deep" ? 20 : 5) : scene.depth === "deep" ? 20 : 5;
    }
    return played;
  }

  /**
   * Each player's motion, measured once (`RigTrack`, an 8.5 ft figure), and
   * what each faces when he isn't running somewhere: the ball he's taking,
   * throwing or tackling at; dropping back before the ball's away (a
   * quarterback's drop, a defender's backpedal), up the field; once it's
   * live, the ball; else up the field, his own way.
   */
  measureBodies(): void {
    let snap = Infinity;
    for (const p of this.players) if (p.set != null) snap = Math.min(snap, p.set);
    if (!Number.isFinite(snap)) snap = 0.5;
    const settle = this.settle;
    const ball = ballMemo(this);
    this.rig = this.players.map((player) => {
      const way = player.team === "offense" ? 1 : -1;
      return RigTrack.measure(0, this.duration, 8.5, (t) => player.position(t), (t): RigFacing => {
        const here = player.position(t);
        const ahead = { x: here.x, y: here.y + 60 * way };
        const a = player.actions.find((a) => t > a.at - 0.45 && t < a.at + 0.2);
        if (a) return { point: a.kind === "spike" || a.kind === "kick" ? ahead : a.toward };
        if (t > snap && t < snap + 1.6) {
          const p = player.position(t - 0.05);
          const q = player.position(t + 0.05);
          if ((q.y - p.y) * way < -0.5 * Math.hypot(q.x - p.x, q.y - p.y)) return { point: ahead, always: true };
        }
        if (t > snap + 0.3 && t < settle) {
          const b = ball(t);
          if (b && Math.hypot(b.x - here.x, b.y - here.y) > 2) return { point: ground(b) };
        }
        return { point: ahead };
      });
    });
  }
}

/** Players by their place in the formation (Swift's `Slot`, as keys). */
type Slot = string;
const S = {
  center: "center",
  guardLeft: "guardLeft",
  guardRight: "guardRight",
  tackleLeft: "tackleLeft",
  tackleRight: "tackleRight",
  quarterback: "quarterback",
  back: "back",
  /** The strong side's tight end and wide receiver, the slot inside them, and the wide receiver alone on the weak side. */
  tightEnd: "tightEnd",
  wideStrong: "wideStrong",
  slot: "slot",
  wideWeak: "wideWeak",
  /** A second tight end off the line, a fullback, a lineman reported in. */
  wing: "wing",
  fullback: "fullback",
  extra: "extra",
  kicker: "kicker",
  holder: "holder",
  punter: "punter",
  returner: "returner",
  deep: "deep",
  front: (i: number) => `front${i}`,
  backer: (i: number) => `backer${i}`,
  corner: (i: number) => `corner${i}`,
  safety: (i: number) => `safety${i}`,
  gunner: (i: number) => `gunner${i}`,
  protector: (i: number) => `protector${i}`,
  lineman: (i: number) => `lineman${i}`,
  rusher: (i: number) => `rusher${i}`,
  cover: (i: number) => `cover${i}`,
  setup: (i: number) => `setup${i}`,
} as const;

const arc = (peak: number): Arc => ({ kind: "arc", peak });
const bounce = (hops: number): Arc => ({ kind: "bounce", hops });
const STRAIGHT: Arc = { kind: "straight" };
const hypotP = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Assembles a script beat by beat. */
export class Builder {
  /** The play as it was run. */
  readonly scene: FootballScene | null;
  /** The play as it stands: the same, unless a flag wiped it out (the spot, the lines, the stamp and the flags are its). */
  readonly ruling: FootballScene | null;
  script = new FootballScript();
  /** The line of scrimmage, in feet. */
  readonly line: number;
  readonly shotgun: boolean;
  /** Where the ball sits across the field: on its hash (a kickoff and a try from the middle). */
  readonly ballX: number;
  /** The ball is snapped a beat after the replay opens on the formation (a try's beat is shorter). */
  readonly snap: number;
  /** Players by their place in the formation. */
  slots = new Map<Slot, number>();
  /** When the action is over (the tackle, the ball coming down), before a flag's walk. */
  over = 0;
  /** The play's moments, for a flag's: the throw, the ball arriving, the stop (and where). */
  release: number | null = null;
  arrival: { readonly at: number; readonly point: Point } | null = null;
  stop: { readonly at: number; readonly point: Point } | null = null;
  /** When a loose ball was recovered. */
  recoveredAt: number | null = null;
  /** The formation's strong side (the tight end's): 1 the offense's right, −1 its left. */
  strong = 1;

  constructor(scene: FootballScene | null, line: number, shotgun: boolean, ruling: FootballScene | null = null) {
    this.scene = scene;
    this.ruling = ruling ?? scene;
    this.line = line;
    this.shotgun = shotgun;
    this.ballX = scene ? (scene.kind.type === "kickoff" || scene.pointAfter != null ? 0 : Gridiron.spot(scene.hash)) : 0;
    this.snap = scene?.pointAfter != null ? 0.4 : 0.5;
  }

  get offense(): number[] {
    return this.script.players.flatMap((p, i) => (p.team === "offense" ? [i] : []));
  }

  get defense(): number[] {
    return this.script.players.flatMap((p, i) => (p.team === "defense" ? [i] : []));
  }

  /** The players in these roles on a team. */
  players(team: Team, ...roles: Role[]): number[] {
    return this.script.players.flatMap((p, i) => (p.team === team && roles.includes(p.role) ? [i] : []));
  }

  /**
   * A place in a formation laid out round a ball in the middle, moved to the
   * ball on its hash: the box moves with it; out wide, the players keep
   * their room to the sideline, squeezed toward the near one, spread toward
   * the far.
   */
  across(x: number): number {
    const box = 24;
    const h = Gridiron.half;
    const ballX = this.ballX;
    if (!(Math.abs(x) > box)) return ballX + x;
    return x > 0 ? ballX + box + ((x - box) * (h - ballX - box)) / (h - box) : ballX - box + ((x + box) * (h + ballX - box)) / (h - box);
  }

  add(slot: Slot, team: Team, role: Role, x: number, dy: number, set = false): void {
    this.slots.set(slot, this.script.players.length);
    this.script.players.push(new Player(team, { x: this.across(x), y: this.line + dy }, role, set ? this.snap : null));
  }

  // MARK: Formations

  /**
   * Eleven on eleven at the line, as the offense lined up: in the gun or
   * under center, its strength (the tight end and the slot) to the side the
   * play went; two backs under center on a run; an extra lineman reported in
   * (a heavy set), an empty backfield, a bunch, the kneel's victory
   * formation. The defense answers it: nickel against three wide, base
   * against two backs, eight in the box against a heavy set, dime against
   * empty.
   */
  scrimmage(): void {
    const formation = this.scene?.formation ?? "base";
    // The strong side: the way the play went (the right when it doesn't say).
    const s = this.scene?.lane === "left" ? -1 : 1;
    this.strong = s;
    const gun = this.shotgun && formation !== "victory";
    const kind = this.scene?.kind.type;
    const running = kind === "rush" || kind === "fumble" || kind === "other";
    this.add(S.center, "offense", "line", 0, -2, true);
    this.add(S.guardLeft, "offense", "line", -5.5, -2.5, true);
    this.add(S.guardRight, "offense", "line", 5.5, -2.5, true);
    this.add(S.tackleLeft, "offense", "line", -11, -3, true);
    this.add(S.tackleRight, "offense", "line", 11, -3, true);
    this.add(S.quarterback, "offense", "quarterback", 0, gun ? -15 : -4.5, !gun);
    const skill = (slot: Slot, role: Role, x: number, dy: number, set = false) => this.add(slot, "offense", role, x * s, dy, set);
    const defend = (base: readonly number[], linebackers: readonly (readonly [number, number])[], corners: readonly (readonly [number, number])[], safeties: readonly (readonly [number, number])[]) => {
      let fronts = base;
      let backers = linebackers;
      // A 3-4: a nose tackle over the ball and the ends a step inside; the fourth man stands up on the weak edge.
      if (this.scene?.front === "threeFour" && fronts.length === 4) {
        const low = Math.min(...fronts);
        const high = Math.max(...fronts);
        fronts = [low + 4, 0, high - 5];
        backers = [...backers, [low - 4, 2.5]];
      }
      fronts.forEach((x, i) => this.add(S.front(i), "defense", "front", x * s, 3, true));
      backers.forEach(([x, dy], i) => this.add(S.backer(i), "defense", "backer", x * s, dy));
      corners.forEach(([x, dy], i) => this.add(S.corner(i), "defense", "corner", x * s, dy));
      safeties.forEach(([x, dy], i) => this.add(S.safety(i), "defense", "safety", x * s, dy));
    };
    const four = [-15, -5.5, 5.5, 19];
    switch (formation) {
      case "base":
        if (!gun && running) {
          // The I: a fullback in front of the back, two wide; base 4-3, the strong safety down.
          skill(S.tightEnd, "tightEnd", 17, -3, true);
          skill(S.fullback, "back", 0, -12);
          skill(S.back, "back", 0, -21);
          skill(S.wideStrong, "receiver", 58, -2);
          skill(S.wideWeak, "receiver", -60, -2);
          defend(
            four,
            [
              [-14, 16],
              [1, 15],
              [16, 16],
            ],
            [
              [-58, 15],
              [56, 15],
            ],
            [
              [24, 26],
              [-8, 42],
            ],
          );
        } else {
          // Three wide, the tight end and the slot to the strong side; the back beside the
          // quarterback in the gun (on the weak side), behind him under center. Nickel.
          skill(S.tightEnd, "tightEnd", 17, -3, true);
          skill(S.slot, "receiver", 38, -4);
          skill(S.wideStrong, "receiver", 62, -2);
          skill(S.wideWeak, "receiver", -62, -2);
          skill(S.back, "back", gun ? -6 : 0, gun ? -15 : -21);
          defend(
            four,
            [
              [-6, 15],
              [10, 15],
            ],
            [
              [-60, 18],
              [60, 18],
              [36, 10],
            ],
            [
              [-24, 40],
              [28, 42],
            ],
          );
        }
        break;
      case "heavy":
        // Jumbo: the lineman reported in on the weak side, two tight ends, two backs. Goal line: eight in the box.
        this.add(S.extra, "offense", "line", -17 * s, -3, true);
        skill(S.tightEnd, "tightEnd", 17, -3, true);
        skill(S.wing, "tightEnd", 22, -7);
        skill(S.fullback, "back", gun ? 6 : 0, gun ? -15 : -12);
        skill(S.back, "back", gun ? -6 : 0, gun ? -15 : -21);
        defend(
          [-20, -7, 4, 15],
          [
            [-14, 9],
            [-4, 8],
            [7, 8],
            [18, 9],
          ],
          [
            [-26, 6],
            [28, 7],
          ],
          [[0, 24]],
        );
        break;
      case "empty":
        // Five wide, the back split out on the weak side. Dime.
        skill(S.tightEnd, "tightEnd", 24, -4);
        skill(S.slot, "receiver", 40, -4);
        skill(S.wideStrong, "receiver", 62, -2);
        skill(S.back, "back", -36, -4);
        skill(S.wideWeak, "receiver", -62, -2);
        defend(
          four,
          [[2, 15]],
          [
            [-60, 16],
            [-34, 10],
            [38, 10],
            [60, 16],
          ],
          [
            [-20, 38],
            [24, 40],
          ],
        );
        break;
      case "bunch":
        // Three in a tight triangle to the strong side; the corners stacked over it.
        skill(S.wideStrong, "receiver", 36.5, -2);
        skill(S.tightEnd, "tightEnd", 33, -5.5);
        skill(S.slot, "receiver", 40, -5);
        skill(S.wideWeak, "receiver", -62, -2);
        skill(S.back, "back", gun ? -6 : 0, gun ? -15 : -21);
        defend(
          four,
          [
            [-6, 15],
            [10, 15],
          ],
          [
            [-60, 18],
            [34, 8],
            [44, 14],
          ],
          [
            [-20, 40],
            [30, 38],
          ],
        );
        break;
      case "victory":
        // The kneel: a back at each hip, one deep, a tight end each side; the defense up close.
        skill(S.back, "back", 5, -9);
        skill(S.fullback, "back", -5, -9);
        skill(S.deep, "back", 0, -30);
        skill(S.tightEnd, "tightEnd", 17, -3, true);
        skill(S.wing, "tightEnd", -17, -3, true);
        defend(
          [-15, -5.5, 5.5, 15],
          [
            [-12, 10],
            [0, 9],
            [12, 10],
          ],
          [
            [-28, 8],
            [28, 8],
          ],
          [
            [-12, 22],
            [12, 22],
          ],
        );
        break;
    }
    this.label(s);
  }

  /**
   * Each man's depth-chart slot, from where he lines up: the offense's
   * linemen left to right (its left is "l"); the defense's ends and tackles
   * (or the nose), its backers weak to strong (inside ones in a 3-4), the
   * corners outside and the nickel in the slot, the strong safety on the
   * tight end's side. The defense's left is the offense's right, as its
   * depth chart has it.
   */
  label(s: number): void {
    const x = (i: number) => this.position(i, 0).x - this.ballX;
    const key = (i: number, k: string) => {
      this.script.players[i]!.key = k;
    };
    const names: readonly (readonly [Slot, string])[] = [
      [S.center, "c"],
      [S.guardLeft, "lg"],
      [S.guardRight, "rg"],
      [S.tackleLeft, "lt"],
      [S.tackleRight, "rt"],
      [S.quarterback, "qb"],
      [S.back, "rb"],
      [S.fullback, "fb"],
      [S.tightEnd, "te"],
      [S.wing, "te"],
      [S.wideStrong, "wr"],
      [S.wideWeak, "wr"],
      [S.slot, "wr"],
    ];
    for (const [slot, name] of names) {
      const i = this.at(slot);
      if (i != null) key(i, name);
    }
    const fronts = this.players("defense", "front").sort((a, b) => x(a) - x(b));
    fronts.forEach((i, k) => {
      const side = x(i) > 0 ? "l" : "r";
      key(i, k === 0 || k === fronts.length - 1 ? `${side}de` : fronts.length === 3 ? "nt" : `${side}dt`);
    });
    const backers = this.players("defense", "backer");
    const edge = backers.filter((i) => this.position(i, 0).y - this.line < 6);
    for (const i of edge) key(i, x(i) * s > 0 ? "slb" : "wlb");
    const inside = backers.filter((i) => !edge.includes(i)).sort((a, b) => x(a) * s - x(b) * s);
    if (edge.length === 0) {
      inside.forEach((i, k) => key(i, k === 0 && inside.length > 1 ? "wlb" : k === inside.length - 1 && inside.length > 2 ? "slb" : "mlb"));
    } else {
      // A 3-4: the strong-side backer, and the inside two by side.
      if (inside.length >= 3) key(inside.pop()!, "slb");
      for (const i of inside) key(i, inside.length === 1 ? "mlb" : x(i) > 0 ? "lilb" : "rilb");
    }
    const corners = this.players("defense", "corner");
    // Swift's max(by:) and min(by:): the first of equals either way.
    const left = corners.filter((i) => x(i) > 0).reduce<number | null>((m, i) => (m == null || x(m) < x(i) ? i : m), null);
    const right = corners.filter((i) => x(i) <= 0).reduce<number | null>((m, i) => (m == null || x(i) < x(m) ? i : m), null);
    for (const i of corners) key(i, i === left ? "lcb" : i === right ? "rcb" : "nb");
    const safeties = this.players("defense", "safety").sort((a, b) => x(b) * s - x(a) * s);
    safeties.forEach((i, k) => key(i, k === 0 && safeties.length > 1 ? "ss" : "fs"));
  }

  /**
   * The man ESPN credits, on his team: the one in his depth-chart slot (the
   * strong safety himself), else one of his slot's kind on its side of the
   * ball (an inside backer for a middle one, a corner in the nickel's place),
   * else the nearest of his position to the spot, else of `fallback`'s.
   */
  man(p: Participant | null | undefined, team: Team, spot: Point, t: number, excluding: ReadonlySet<number> = new Set(), fallback: readonly Role[] = []): number | null {
    const pool = this.script.players.flatMap((player, i) => (player.team === team && !excluding.has(i) ? [i] : []));
    const nearest = (among: readonly number[]): number | null => {
      let best: number | null = null;
      let bestDistance = Infinity;
      for (const i of among) {
        const d = hypotP(this.position(i, t), spot);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      return best;
    };
    const slot = p?.slot;
    if (slot != null) {
      const own = pool.find((i) => this.script.players[i]!.key === slot);
      if (own != null) return own;
      const kind = Builder.kind(slot);
      let alike = pool.filter((i) => {
        const k = this.script.players[i]!.key;
        return k != null && Builder.kind(k) === kind;
      });
      // His side: the slot's left or right, else the strong side (the tight end's) for the strong-side backer,
      // the strong safety and the nickel, the weak side for the weak-side backer.
      const lane = new DepthSlot(slot, [], team === "defense", null).lane;
      const side = lane != null ? Builder.sign(lane) : ["slb", "ss", "nb"].includes(slot) ? this.strong : slot === "wlb" ? -this.strong : 0;
      if (side !== 0) {
        const sided = alike.filter((i) => (this.position(i, 0).x - this.ballX) * side > 0);
        if (sided.length > 0) alike = sided;
      }
      const i = nearest(alike);
      if (i != null) return i;
    }
    const roles = Builder.roles(p?.position ?? null);
    if (roles.length > 0) {
      const i = nearest(pool.filter((k) => roles.includes(this.script.players[k]!.role)));
      if (i != null) return i;
    }
    if (fallback.length > 0) {
      const i = nearest(pool.filter((k) => fallback.includes(this.script.players[k]!.role)));
      if (i != null) return i;
    }
    return nearest(pool.filter((k) => this.script.players[k]!.role !== "official"));
  }

  /** A slot's kind, whichever side it's on: an end, an interior lineman, a backer, a corner, a safety; the offense's line, receivers, tight ends, backs. */
  static kind(slot: string): string {
    switch (slot) {
      case "lde":
      case "rde":
        return "de";
      case "ldt":
      case "rdt":
      case "nt":
      case "ut":
      case "ng":
        return "dt";
      case "wlb":
      case "mlb":
      case "slb":
      case "lilb":
      case "rilb":
      case "lolb":
      case "rolb":
        return "lb";
      case "lcb":
      case "rcb":
      case "nb":
        return "cb";
      case "ss":
      case "fs":
        return "s";
      case "c":
      case "lg":
      case "rg":
      case "lt":
      case "rt":
      case "og":
      case "t":
        return "ol";
      case "rb":
      case "fb":
        return "rb";
      default:
        return slot;
    }
  }

  /**
   * The punt: the snapper and six on the line, three protectors, the
   * punter fifteen yards back, a gunner wide each side; across from them
   * six at the line, a jammer on each gunner, the returner deep.
   */
  puntFormation(returner: Point): void {
    this.add(S.center, "offense", "line", 0, -2, true);
    [-5.5, 5.5, -11, 11, -16.5, 16.5].forEach((x, i) => this.add(S.lineman(i), "offense", "line", x, -2.5, true));
    (
      [
        [-4, -15],
        [4, -15],
        [0, -21],
      ] as const
    ).forEach(([x, dy], i) => this.add(S.protector(i), "offense", "back", x, dy));
    this.add(S.punter, "offense", "punter", 0, -45);
    this.add(S.gunner(0), "offense", "cover", -64, -2);
    this.add(S.gunner(1), "offense", "cover", 62, -2);
    [-20, -11, -4, 4, 11, 20].forEach((x, i) => this.add(S.rusher(i), "defense", "front", x, 3, true));
    this.add(S.corner(0), "defense", "corner", -60, 5);
    this.add(S.corner(1), "defense", "corner", 58, 5);
    this.add(S.backer(0), "defense", "backer", 0, 30);
    this.slots.set(S.returner, this.script.players.length);
    this.script.players.push(new Player("defense", returner, "returner"));
  }

  /**
   * The field goal: the snapper and eight on the line with a wing at each
   * end, the holder seven yards back, the kicker a step off him; nine
   * across the line to block it, two back.
   */
  kickFormation(): void {
    this.add(S.center, "offense", "line", 0, -2, true);
    [-4.5, 4.5, -9, 9, -13.5, 13.5, -18, 18].forEach((x, i) => this.add(S.lineman(i), "offense", "line", x, -2.5, true));
    this.add(S.holder, "offense", "holder", 0, -21);
    this.add(S.kicker, "offense", "kicker", -7, -30);
    [-17, -12, -7, -2.5, 2.5, 7, 12, 17, 22].forEach((x, i) => this.add(S.rusher(i), "defense", "front", x, 3, true));
    this.add(S.safety(0), "defense", "safety", -14, 24);
    this.add(S.safety(1), "defense", "safety", 14, 24);
  }

  /**
   * The kickoff as the NFL sets it now: the kicker behind the ball on his
   * 35, ten teammates across the field at the other team's 40; nine of
   * theirs in the setup zone five yards beyond, two deep.
   */
  kickoffFormation(returner: Point): void {
    this.add(S.kicker, "offense", "kicker", -4, -15);
    [-66, -52, -38, -24, -10, 10, 24, 38, 52, 66].forEach((x, i) => this.add(S.cover(i), "offense", "cover", x, 75));
    [-58, -40, -24, -10, 4, 18, 32, 46, 62].forEach((x, i) => this.add(S.setup(i), "defense", "front", x, 93 + (i % 2) * 9));
    this.add(S.deep, "defense", "returner", returner.x > 0 ? -18 : 18, Math.max(returner.y - this.line - 24, 120));
    this.slots.set(S.returner, this.script.players.length);
    this.script.players.push(new Player("defense", returner, "returner"));
  }

  // MARK: Helpers

  at(slot: Slot): number | null {
    return this.slots.get(slot) ?? null;
  }

  position(i: number, t: number): Point {
    return this.script.players[i]!.position(t);
  }

  move(i: number | null, path: readonly Point[], start: number, end: number, ease: Ease = "inOut"): void {
    if (i == null) return;
    this.script.players[i]!.move(path, start, end, ease);
  }

  /** Moves someone part of the way toward a point. */
  drift(i: number, toward: Point, fraction: number, cap: number, start: number, end: number): void {
    const here = this.position(i, start);
    const dx = toward.x - here.x;
    const dy = toward.y - here.y;
    const d = Math.hypot(dx, dy);
    if (!(d > 1)) return;
    const step = Math.min(d * fraction, cap);
    this.move(i, [{ x: here.x + (dx / d) * step, y: here.y + (dy / d) * step }], start, end, "out");
  }

  fly(from: FieldPoint, to: FieldPoint, start: number, time: number, arc: Arc, ease: Ease = "linear"): number {
    this.script.flights.push(new Flight(start, start + time, from, to, arc, ease));
    this.script.legs.push({ from: start, until: start + time, hand: { kind: "flight", index: this.script.flights.length - 1 } });
    return this.script.flights.length - 1;
  }

  carry(i: number, start: number, end: number): void {
    this.script.legs.push({ from: start, until: end, hand: { kind: "carry", player: i } });
  }

  /** The ball on the ground at the line before the snap. */
  get spot(): FieldPoint {
    return { x: this.ballX, y: this.line, z: 0.6 };
  }

  /** The snap: to the quarterback's hands, or back to the holder or the punter. */
  snapBall(receiver: number, height = 3.4): number {
    const { snap, line } = this;
    this.script.legs.push({ from: 0, until: snap, hand: { kind: "spot", point: this.spot } });
    const target = this.position(receiver, snap);
    const d = Math.abs(target.y - line);
    this.script.flashes.push({ beat: "snap", at: snap, point: this.spot });
    if (d < 8) {
      // Under center: in his hands at once.
      this.carry(receiver, snap, snap + 0.05);
      return snap + 0.05;
    }
    const time = clamp(d / 75, 0.22, 0.5);
    this.fly({ x: this.ballX, y: line - 1, z: 1 }, fieldPoint(target, height), snap, time, arc(d > 30 ? 3 : 1.5));
    return snap + time;
  }

  /** Of the players on a team and in a position, the nearest a spot at t. */
  nearest(team: Team, p: Point, t: number, roles: readonly Role[] = [], excluding: ReadonlySet<number> = new Set()): number | null {
    let best: number | null = null;
    let bestDistance = Infinity;
    this.script.players.forEach((player, i) => {
      if (player.team !== team || excluding.has(i) || (roles.length > 0 && !roles.includes(player.role))) return;
      const d = hypotP(this.position(i, t), p);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    });
    return best;
  }

  static roles(position: Position | null): Role[] {
    switch (position) {
      case "defensiveLine":
        return ["front"];
      case "linebacker":
        return ["backer"];
      case "corner":
        return ["corner"];
      case "safety":
        return ["safety"];
      // College credits a "DB" without saying corner or safety.
      case "defensiveBack":
        return ["corner", "safety"];
      case "receiver":
        return ["receiver"];
      case "tightEnd":
        return ["tightEnd"];
      case "back":
      case "fullback":
        return ["back"];
      case "quarterback":
        return ["quarterback"];
      case "lineman":
        return ["line"];
      case "kicker":
        return ["kicker"];
      case "punter":
        return ["punter"];
      default:
        return [];
    }
  }

  /**
   * The ones credited with the stop (each the man in his slot, else the
   * nearest of his position), else the nearest defender: they arrive with
   * the ball carrier.
   */
  tackle(runner: number, time: number, spot: Point, team: Team, credited: readonly (Participant | null)[], start: number, excluding: ReadonlySet<number> = new Set()): number[] {
    const taken = new Set<number>([...excluding, runner]);
    const tacklers: number[] = [];
    for (const credit of credited.slice(0, 3)) {
      const i = this.man(credit, team, spot, start, taken);
      if (i != null) {
        taken.add(i);
        tacklers.push(i);
      }
    }
    this.stop = { at: time, point: spot };
    tacklers.forEach((i, k) => {
      const here = this.position(i, start);
      const dx = here.x - spot.x;
      const dy = here.y - spot.y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const side = k === 0 ? 0 : k % 2 === 0 ? 1 : -1;
      const contact = { x: spot.x + (dx / d) * 3 + side * 3, y: spot.y + (dy / d) * 3 };
      this.move(i, [contact], start, time, "inOut");
      this.script.players[i]!.act("tackle", time, spot);
    });
    if (tacklers.length > 0) {
      this.script.flashes.push({ beat: "hit", at: time, point: fieldPoint(spot, 3) });
      this.script.players[runner]!.holds.push({ kind: "down", from: time + 0.12, until: Infinity });
    }
    return tacklers;
  }

  /** Everyone near the ball closes on it a little, defenders more. */
  converge(p: Point, start: number, end: number, except: ReadonlySet<number>): void {
    this.script.players.forEach((player, i) => {
      if (except.has(i)) return;
      const here = this.position(i, start);
      const d = hypotP(here, p);
      if (!(d > 12 && d < 160)) return;
      const defense = player.team === "defense";
      this.drift(i, p, defense ? 0.35 : 0.12, defense ? 30 : 14, start, end);
    });
  }

  /**
   * The receiver for a pass of this side, depth and receiving position: of
   * the receivers on that side, the one inside on a short ball, the one
   * outside on a deep one; over the middle, whoever's inside.
   */
  target(credited: Position | null, lane: Lane): number | null {
    switch (credited) {
      case "tightEnd":
        return this.at(S.tightEnd) ?? this.at(S.wing);
      case "back":
        return this.at(S.back);
      case "fullback":
        return this.at(S.fullback) ?? this.at(S.back);
      default: {
        const side = Builder.sign(lane);
        const receivers = this.players("offense", "receiver");
        const pool = receivers.length === 0 ? this.players("offense", "tightEnd") : receivers;
        const out = (i: number) => (this.position(i, 0).x - this.ballX) * (side === 0 ? 1 : side);
        const onSide = side === 0 ? pool : pool.filter((i) => out(i) > 0);
        const choices = onSide.length === 0 ? pool : onSide;
        if (choices.length === 0) return null;
        // Swift's min(by:) and max(by:): the first of equals either way.
        if (side === 0) return choices.reduce((a, b) => (Math.abs(out(b)) < Math.abs(out(a)) ? b : a));
        return this.scene?.depth === "deep" ? choices.reduce((a, b) => (out(a) < out(b) ? b : a)) : choices.reduce((a, b) => (out(b) < out(a) ? b : a));
      }
    }
  }

  static sign(lane: Lane | null): number {
    return lane === "left" ? -1 : lane === "right" ? 1 : 0;
  }

  /** Where a play ended on the field: its yard line, and across, by the side it went to (over the sideline when he went out of bounds). */
  endPoint(p: Point, lane: Lane | null, y: number): Point {
    const scene = this.scene;
    if (!scene) return { x: p.x, y };
    const side = Math.abs(p.x - this.ballX) < 0.5 ? Builder.sign(lane) : p.x > this.ballX ? 1 : -1;
    if (scene.outOfBounds) return { x: (side === 0 ? 1 : side) * (Gridiron.half + 3), y };
    const x = p.x + side * Math.abs(y - p.y) * 0.12;
    return { x: clamp(x, -70, 70), y };
  }

  /** The end spot in feet: in the end zone for a touchdown. */
  get endY(): number {
    const scene = this.scene;
    if (!scene) return this.line;
    if (scene.scoring === "touchdown") return scene.to <= 0.5 ? -12 : 312;
    return Gridiron.y(scene.to);
  }

  // MARK: Build

  build(): void {
    const scene = this.scene;
    if (!scene) return;
    if (scene.kind.type === "fieldGoal") this.script.yaw = 0;
    if (scene.kind.type === "extraPoint") this.script.yaw = 0;
    // A foul before the snap (a false start, a delay): the ball is never snapped, whatever college logs after it.
    const stopped = this.ruling?.flags.some((f) => f.timing === "beforeSnap" && f.status === "accepted") === true;
    switch (stopped ? "penalty" : scene.kind.type) {
      case "pass":
      case "incomplete":
      case "interception":
        this.scrimmage();
        this.pass();
        break;
      case "rush":
      case "other":
        this.scrimmage();
        this.rush();
        break;
      case "kneel":
        this.scrimmage();
        this.kneel();
        break;
      case "spike":
        this.scrimmage();
        this.spike();
        break;
      case "sack":
        this.scrimmage();
        this.sack();
        break;
      case "fumble": {
        // Lost from a sack (a strip-sack), after a catch, or on a run.
        this.scrimmage();
        const words = playText(scene.text).toLowerCase();
        if (scene.sackers.length > 0 || words.includes("sacked")) this.sack();
        else if (words.includes(" pass ") && !words.includes("incomplete")) this.pass();
        else this.rush();
        break;
      }
      case "punt":
        this.punt();
        break;
      case "kickoff":
        this.kickoff();
        break;
      case "fieldGoal":
      case "extraPoint":
        this.fieldGoal();
        break;
      case "penalty":
        this.scrimmage();
        this.penalty();
        break;
    }
    if (!stopped && scene.kind.type !== "penalty") this.flags();
    this.finish();
    this.headline();
    this.measureStamp();
    this.settle();
    this.shoot();
  }

  // MARK: Pass

  /** The quarterback's drop, the routes, the throw to where it was caught (or broken up, or picked off), the run after the catch and the stop. */
  pass(): void {
    const scene = this.scene;
    const qb = this.at(S.quarterback);
    if (!scene || qb == null) return;
    const { snap, line, shotgun, script } = this;
    // (A catch that was then fumbled away is a catch first.)
    const caught = scene.kind.type === "pass" || scene.kind.type === "fumble";
    const picked = scene.kind.type === "interception";
    const deep = scene.depth === "deep" || (scene.air ?? 0) >= 18;
    const lane = scene.lane ?? "middle";
    const receiver = this.target(scene.position("receiver"), lane) ?? this.at(S.tightEnd) ?? this.at(S.back) ?? qb;
    const inHand = this.snapBall(qb);
    // The drop: seven yards deep from under center, a step or two in the gun.
    const pocket = { x: this.ballX, y: line - 21 };
    this.move(qb, [pocket], snap + 0.08, snap + (shotgun ? 0.55 : 0.8), "out");
    const release = snap + (deep ? 1.35 : 1.0) + (shotgun ? 0 : 0.1);
    this.carry(qb, inHand, release);
    script.players[qb]!.act("throwBall", release, { x: this.ballX, y: line + 60 });

    // Where it was caught, picked off or thrown to.
    const air = scene.air ?? (deep ? 24 : 7);
    const side = Builder.sign(lane);
    const start = this.position(receiver, 0);
    const back = script.players[receiver]!.role !== "receiver";
    let catchX = side === 0 ? (deep ? 4 : -6) : side * (deep ? 50 : back ? 26 : 38);
    if (air < 0) catchX = (side === 0 ? 1 : side) * 30;
    const catchPoint = { x: clamp(this.across(catchX), -72, 72), y: line + Gridiron.y(air) };
    const from: FieldPoint = { x: pocket.x + 1.5, y: pocket.y + 1, z: 7 };
    const d = Math.hypot(catchPoint.x - from.x, catchPoint.y - from.y);
    const time = clamp(0.26 + d / 150, 0.38, 1.25);
    const arrive = release + time;
    const flight = this.fly(from, fieldPoint(catchPoint, caught || picked ? 5 : 4), release, time, arc(deep ? 12 + d * 0.11 : 3 + d * 0.045));
    // The route: a stem upfield, then the break to the ball.
    const stem = { x: start.x + (catchPoint.x - start.x) * 0.2, y: start.y + Math.max((catchPoint.y - start.y) * 0.6, 0) };
    this.move(receiver, catchPoint.y - start.y > 24 ? [stem, catchPoint] : [catchPoint], snap + 0.05, picked || !caught ? arrive + 0.05 : arrive, "inOut");
    this.decoys(new Set([receiver, qb]), release);
    this.protect(snap + 0.85);
    this.release = release;
    this.arrival = { at: arrive, point: catchPoint };
    const taken = new Set<number>([qb, receiver]);
    for (const i of this.pressure(qb, release, pocket)) taken.add(i);

    if (picked) {
      this.interception(receiver, arrive, catchPoint, flight, taken);
      return;
    }
    // The defender on him closes as the ball arrives: the one credited with the breakup, else whoever covers him.
    const coverRoles: Role[] = deep ? ["corner", "safety"] : ["corner", "backer", "safety"];
    const breakup = scene.participants.find((p) => p.role === "passDefender") ?? null;
    const defender = (breakup ? this.man(breakup, "defense", catchPoint, snap, taken, coverRoles) : null) ?? this.nearest("defense", catchPoint, snap, coverRoles, taken);
    if (!caught) {
      // Broken up, or just out of reach: it comes down on the grass.
      if (defender != null) this.move(defender, [{ x: catchPoint.x + 3, y: catchPoint.y + 2 }], snap + 0.1, arrive - 0.02);
      const broken = scene.position("passDefender") != null;
      if (broken && defender != null) {
        script.players[defender]!.act("block", arrive, catchPoint);
        script.flashes.push({ beat: "deflect", at: arrive, point: fieldPoint(catchPoint, 5) });
      }
      const away = { x: catchPoint.x + (broken ? -side * 10 : side * 6), y: catchPoint.y + (broken ? -6 : 14) };
      this.fly(fieldPoint(catchPoint, 4), fieldPoint(away), arrive, 0.5, bounce(2), "out");
      script.players[receiver]!.act("catchHigh", arrive, ground(from));
      this.over = arrive + 0.5;
      script.stamp = arrive + 0.4;
      return;
    }
    script.players[receiver]!.act(deep ? "catchHigh" : "catchChest", arrive, ground(from));
    script.flashes.push({ beat: "catchBall", at: arrive, point: fieldPoint(catchPoint, 5) });
    if (defender != null) {
      this.move(defender, [{ x: catchPoint.x + (catchPoint.x > 0 ? 6 : -6), y: catchPoint.y + 9 }], snap + 0.1, arrive + 0.15);
      taken.add(defender);
    }
    this.run(receiver, catchPoint, arrive + 0.04, taken);
  }

  /** The other receivers run their routes; the backs and the tight end release; corners and safeties turn and run with them. */
  decoys(except: ReadonlySet<number>, release: number): void {
    const { snap, line, ballX } = this;
    for (const i of this.players("offense", "receiver", "tightEnd", "back")) {
      if (except.has(i)) continue;
      const role = this.script.players[i]!.role;
      const p = this.position(i, 0);
      const depth = role === "back" ? 10 : role === "tightEnd" ? 24 : 42;
      const lean = role === "back" ? (p.x >= ballX ? 16 : -16) : p.x > ballX ? -8 : 8;
      this.move(i, [{ x: p.x + lean, y: Math.max(p.y, line) + depth }], snap + 0.05, release + 0.4, "inOut");
    }
    for (const i of this.players("defense", "corner")) {
      const p = this.position(i, 0);
      this.move(i, [{ x: ballX + (p.x - ballX) * 0.92, y: p.y + 26 }], snap + 0.08, release + 0.5, "out");
    }
    for (const i of this.players("defense", "safety", "backer")) {
      const p = this.position(i, 0);
      this.move(i, [{ x: ballX + (p.x - ballX) * 0.85, y: p.y + (this.script.players[i]!.role === "safety" ? 10 : 12) }], snap + 0.08, snap + 0.9, "out");
    }
  }

  /** The pocket: the line sets back, the front rushes into it. */
  protect(rush: number): void {
    const { snap, line, ballX } = this;
    for (const i of this.players("offense", "line")) {
      const p = this.position(i, 0);
      this.move(i, [{ x: ballX + (p.x - ballX) * 1.1, y: p.y - 6 }], snap + 0.04, snap + 0.55, "out");
      this.script.players[i]!.act("block", snap + 0.55, { x: p.x, y: line + 10 });
    }
    for (const i of this.players("defense", "front")) {
      if (this.script.players[i]!.moves.some((m) => m.start > snap)) continue;
      const p = this.position(i, 0);
      this.move(i, [{ x: ballX + (p.x - ballX) * 0.85, y: line - 5 }], snap + 0.04, rush, "out");
    }
  }

  /**
   * The rush getting home as he throws. A hit (the NFL's bracketed credit):
   * the man in his slot, round the edge or straight up the middle, reaches
   * the quarterback as the ball leaves and puts him on his back after it. A
   * hurry (college's "QB hurried by"): he closes on him, a stride short.
   * Returns who came.
   */
  pressure(qb: number, release: number, pocket: Point): Set<number> {
    const pressure = this.scene?.pressure;
    if (!pressure) return new Set();
    const { snap, line, ballX, script } = this;
    const thrower = this.position(qb, release);
    const by: number[] = [];
    pressure.by.slice(0, 2).forEach((credit, k) => {
      const i = this.man(credit, "defense", pocket, 0, new Set(by), ["front", "backer"]);
      if (i == null) return;
      by.push(i);
      const start = this.position(i, 0);
      const side = start.x >= ballX ? 1 : -1;
      const reach = pressure.hit ? 2.2 : 5.5;
      const contact = { x: thrower.x + side * reach * 0.8, y: thrower.y + reach * 0.6 };
      const wide = Math.abs(start.x - ballX) > 12;
      const path = wide ? [{ x: ballX + side * Math.max(Math.abs(start.x - ballX) + 4, 16), y: line - 6 }, contact] : [contact];
      const arrive = release + (pressure.hit ? 0.06 : -0.05) + k * 0.08;
      this.move(i, path, snap + 0.04, arrive, "inOut");
      if (pressure.hit) script.players[i]!.act("tackle", arrive + 0.04, thrower);
    });
    const hitter = by[0];
    if (!pressure.hit || hitter == null) return new Set(by);
    const hit = release + 0.1;
    script.flashes.push({ beat: "hit", at: hit, point: fieldPoint(thrower, 4) });
    // Driven back a stride from the hit, and down.
    const from = this.position(hitter, hit);
    const dx = thrower.x - from.x;
    const dy = thrower.y - from.y;
    const d = Math.max(Math.hypot(dx, dy), 0.1);
    this.move(qb, [{ x: thrower.x + (dx / d) * 3, y: thrower.y + (dy / d) * 3 }], hit, hit + 0.35, "out");
    script.players[qb]!.holds.push({ kind: "knocked", from: hit + 0.06, until: Infinity });
    script.players[hitter]!.holds.push({ kind: "down", from: hit + 0.22, until: Infinity });
    return new Set(by);
  }

  interception(receiver: number, arrive: number, point: Point, flight: number, taken: Set<number>): void {
    const scene = this.scene;
    if (!scene) return;
    const { snap, line, script } = this;
    // The man who picked it off, by his slot: credited as the interceptor, or the returner, or for the breakup.
    let credit: Participant | null = null;
    for (const role of ["interceptor", "returner", "passDefender"]) {
      credit = scene.participants.find((p) => p.role === role) ?? null;
      if (credit) break;
    }
    const taker = this.man(credit, "defense", point, snap, taken, ["corner", "safety", "backer"]);
    if (taker == null) return;
    // He jumps the route: in front of the receiver as the ball arrives.
    const jump = { x: point.x - (point.x > this.ballX ? 2 : -2), y: point.y - 3 };
    this.move(taker, [jump], snap + 0.15, arrive, "inOut");
    const f = script.flights[flight]!;
    script.flights[flight] = new Flight(f.start, f.end, f.from, fieldPoint(jump, 5), f.arc, f.ease);
    script.players[taker]!.act("catchChest", arrive, { x: this.ballX, y: line - 20 });
    script.flashes.push({ beat: "catchBall", at: arrive, point: fieldPoint(jump, 5) });
    script.players[receiver]!.act("catchHigh", arrive - 0.04, { x: this.ballX, y: line - 20 });
    taken.add(taker);
    script.score = null;
    this.run(taker, jump, arrive + 0.05, taken, true);
  }

  /**
   * The ball carrier from where he got it to where he was stopped: the
   * tacklers arrive with him, everyone else closes in. Into the end zone
   * with both arms up for a touchdown; out over the sideline when he went out.
   * A fumble on the way (lost, or recovered by his own side) stops him
   * where it came loose, and the scramble for it takes over.
   */
  run(runner: number, start: Point, time: number, taken: ReadonlySet<number>, returning = false, path: readonly Point[] = [], recovered = false): void {
    const scene = this.scene;
    if (!scene) return;
    const script = this.script;
    const opponents: Team = script.players[runner]!.team === "offense" ? "defense" : "offense";
    const loose = scene.loose;
    if (!returning && !recovered && loose != null && (scene.kind.type === "rush" || scene.kind.type === "pass" || scene.kind.type === "fumble")) {
      // Stripped where it came loose: the man credited with it (else the first tackler) gets there with him.
      const at = this.endPoint(path[path.length - 1] ?? start, scene.lane, Gridiron.y(loose));
      let length = 0;
      let previous = start;
      for (const p of [...path, at]) {
        length += hypotP(p, previous);
        previous = p;
      }
      const arrive = time + clamp(length / 47, 0.35, 2.2);
      this.move(runner, [...path, at], time, arrive, "out");
      this.carry(runner, time, arrive);
      const credit = scene.stripper ?? scene.participants.find((p) => p.role === "tackler") ?? null;
      const stripped = new Set<number>([...taken, runner]);
      const from = Math.max(time - 0.3, this.snap);
      const stripper = this.man(credit, opponents, at, from, stripped);
      if (stripper != null) {
        const here = this.position(stripper, from);
        const d = Math.max(hypotP(here, at), 1);
        this.move(stripper, [{ x: at.x + ((here.x - at.x) / d) * 2.5, y: at.y + ((here.y - at.y) / d) * 2.5 }], from, arrive, "inOut");
        script.players[stripper]!.act("strip", arrive, at);
        stripped.add(stripper);
      }
      script.players[runner]!.holds.push({ kind: "down", from: arrive + 0.14, until: Infinity });
      this.stop = { at: arrive, point: at };
      this.fumbled(runner, arrive, at, stripped);
      return;
    }
    this.carry(runner, time, Infinity);
    // Stopped where the text says when a flag's yards come after; else at the end spot.
    const y = scene.scoring === "touchdown" ? this.endY : Gridiron.y((scene.penalty != null ? scene.stopped : null) ?? scene.to);
    const stop = this.endPoint(path[path.length - 1] ?? start, scene.lane, y);
    const finish = scene.scoring === "touchdown" ? { x: stop.x * 0.6, y: this.endY } : stop;
    const route = [...path, finish];
    let length = 0;
    let previous = start;
    for (const p of route) {
      length += hypotP(p, previous);
      previous = p;
    }
    const duration = clamp(length / 47, 0.35, 2.5);
    const arrive = time + duration;
    this.move(runner, route, time, arrive, "out");
    this.over = arrive;
    if (scene.scoring === "touchdown") {
      script.players[runner]!.holds.push({ kind: "touchdown", from: arrive + 0.05, until: Infinity });
      // The moment the ball crosses the goal line.
      const goal = returning || scene.to <= 0.5 ? 0 : 300;
      const u = clamp(Math.abs(goal - start.y) / Math.max(Math.abs(finish.y - start.y), 1), 0, 1);
      script.score = time + duration * clamp(u * 0.82, 0, 1);
      script.scorePoint = { x: finish.x * 0.8, y: goal, z: 0 };
      this.converge(finish, time, arrive + 0.2, new Set([...taken, runner]));
      script.end = fieldPoint(finish);
      script.stamp = arrive + 0.15;
      return;
    }
    const credited = scene.participants.filter((p) => p.role === "tackler" || p.role === "assistedBy");
    const tacklers =
      scene.outOfBounds && credited.length === 0 ? [] : this.tackle(runner, arrive, finish, opponents, credited.length === 0 ? [null] : credited, Math.max(time - 0.3, this.snap), taken);
    if (tacklers.length === 0) this.stop = { at: arrive, point: finish };
    this.converge(finish, time, arrive + 0.15, new Set([...taken, ...tacklers, runner]));
    script.end = fieldPoint(finish);
    script.stamp = arrive + 0.12;
  }

  /**
   * The ball out: it pops from `carrier`'s arms at `time` where it came
   * loose and skitters to where it was recovered, the nearest man from each
   * side laying out for it, and the man ESPN credits comes up with it (the
   * defense's on a fumble lost): then the return, or he stays down on it.
   */
  fumbled(carrier: number, time: number, loose: Point, taken: ReadonlySet<number>): void {
    const scene = this.scene;
    if (!scene) return;
    const { script, snap } = this;
    const lost = scene.kind.type === "fumble";
    const own = script.players[carrier]!.team;
    const team: Team = lost ? (own === "offense" ? "defense" : "offense") : own;
    const recoveryY = Gridiron.y(scene.recovered ?? scene.turn ?? scene.loose ?? scene.to);
    const recovery = { x: loose.x + (Math.abs(recoveryY - loose.y) > 3 ? 4 : 1.5), y: recoveryY };
    // Up out of his arms, down, and away.
    const out = time + 0.3;
    this.fly(fieldPoint(this.position(carrier, time), 3.4), fieldPoint(loose, 0.6), time, 0.3, arc(3.5));
    const rolls = Math.max(hypotP(recovery, loose) / 26, 0.35);
    this.fly(fieldPoint(loose, 0.6), fieldPoint(recovery, 0.6), out, rolls, bounce(2), "out");
    script.flashes.push({ beat: "deflect", at: time + 0.02, point: fieldPoint(this.position(carrier, time), 3.4) });
    const reached = out + rolls;
    this.recoveredAt = reached;
    const busy = new Set<number>([...taken, carrier]);
    const credit = scene.participants.find((p) => p.role === "recoverer") ?? null;
    // (The man who lost it can fall on it himself: "and recovers".)
    const others = new Set(taken);
    others.delete(carrier);
    const taker = this.man(credit, team, recovery, time, others) ?? carrier;
    busy.add(taker);
    const returns = lost && (scene.scoring === "touchdown" || Math.abs(Gridiron.y(scene.to) - recovery.y) > 4);
    const advances = !lost && Math.abs(Gridiron.y(scene.to) - recovery.y) > 4;
    if (taker !== carrier) {
      this.move(taker, [recovery], Math.max(time - 0.2, snap), reached, "inOut");
      script.players[taker]!.act(returns || advances ? "scoop" : "scramble", reached, recovery);
      if (!(returns || advances)) script.players[taker]!.holds.push({ kind: "down", from: reached + 0.18, until: Infinity });
    }
    // The scramble: the nearest man on each side lays out for it, just behind him.
    for (const side of ["offense", "defense"] as const) {
      const i = this.nearest(side, recovery, time, [], busy);
      if (i == null) continue;
      busy.add(i);
      const here = this.position(i, time);
      const dx = here.x - recovery.x;
      const dy = here.y - recovery.y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      if (!(d < 60)) continue;
      this.move(i, [{ x: recovery.x + (dx / d) * 3.5, y: recovery.y + (dy / d) * 3.5 }], time, reached + 0.08, "inOut");
      script.players[i]!.act("scramble", reached + 0.08, recovery);
      script.players[i]!.holds.push({ kind: "down", from: reached + 0.25, until: Infinity });
    }
    if (returns || advances) {
      this.run(taker, recovery, reached + 0.06, busy, lost, [], true);
      return;
    }
    this.carry(taker, reached, Infinity);
    this.converge(recovery, time, reached + 0.3, busy);
    this.over = reached + 0.35;
    script.end = fieldPoint(recovery);
    script.stamp = reached + 0.3;
  }

  // MARK: Run

  /**
   * The handoff at the mesh, the back through the hole ESPN names (a
   * guard's, a tackle's, outside the end, up the middle) and on to the
   * spot; the quarterback keeps it on a scramble or a sneak.
   */
  rush(): void {
    const scene = this.scene;
    const qb = this.at(S.quarterback);
    const back = this.at(S.back);
    if (!scene || qb == null || back == null) return;
    const { snap, line, shotgun, script } = this;
    const side = Builder.sign(scene.lane);
    const carrier = scene.position("rusher") ?? scene.position("fumbler");
    const keeper = carrier === "quarterback";
    let runner: number;
    switch (carrier) {
      case "quarterback":
        runner = qb;
        break;
      // A sweep: the receiver nearest the side it went.
      case "receiver": {
        const aim = this.across(side * 34);
        const receivers = this.players("offense", "receiver");
        runner = receivers.length > 0 ? receivers.reduce((a, b) => (Math.abs(this.position(b, 0).x - aim) < Math.abs(this.position(a, 0).x - aim) ? b : a)) : back;
        break;
      }
      case "tightEnd":
        runner = this.at(S.tightEnd) ?? back;
        break;
      case "fullback":
        runner = this.at(S.fullback) ?? back;
        break;
      default:
        runner = back;
    }
    const inHand = this.snapBall(qb);
    if (scene.text.includes("(Aborted)")) {
      // The snap never made it: on the ground at his feet, and the scramble for it.
      script.legs.push({ from: inHand, until: inHand + 0.12, hand: { kind: "carry", player: qb } });
      this.protect(snap + 0.6);
      const loose = { x: this.position(qb, inHand).x + 1.5, y: Gridiron.y(scene.loose ?? scene.from) - 1 };
      script.players[qb]!.act("scramble", inHand + 0.5, loose);
      script.players[qb]!.holds.push({ kind: "down", from: inHand + 0.68, until: Infinity });
      this.fumbled(qb, inHand + 0.12, loose, new Set([qb]));
      return;
    }
    const hole = scene.gap === "guard" ? 7 : scene.gap === "tackle" ? 13.5 : scene.gap === "end" ? 26 : 0;
    const holeX = this.ballX + side * hole;
    const gain = scene.to - scene.from;
    const through = { x: holeX, y: line + (gain > 0 ? 3 : -1) };
    let meshTime = snap + (shotgun ? 0.36 : 0.45);
    let mesh = this.position(qb, snap);
    if (keeper) {
      // A scramble: he drops, then runs for it.
      const scrambles = scene.text.includes("scrambles");
      const pocket = { x: this.ballX, y: line - (scrambles ? 19 : 6) };
      this.move(qb, [pocket], snap + 0.08, snap + (scrambles ? 0.7 : 0.25), "out");
      meshTime = snap + (scrambles ? 1.2 : 0.3);
      mesh = pocket;
      this.carry(qb, inHand, meshTime);
      if (scrambles) this.protect(snap + 1.0);
    } else {
      // The quarterback opens to the back; they meet a few yards deep.
      mesh = { x: this.ballX + side * 2.5, y: line - (shotgun ? 13 : 10) };
      this.move(qb, [{ x: mesh.x - side * 1.5, y: mesh.y + 1 }], snap + 0.05, meshTime - 0.05, "out");
      this.move(runner, [mesh], snap + 0.02, meshTime, "inOut");
      this.carry(qb, inHand, meshTime);
      script.players[qb]!.act("handoff", meshTime, mesh);
      // The fake: he carries out the boot the other way.
      this.move(qb, [{ x: this.ballX - side * 14 + (side === 0 ? 8 : 0), y: line - 16 }], meshTime + 0.1, meshTime + 0.9, "out");
    }
    // The line and the tight ends drive the way of the run and open the hole; a fullback leads through it.
    for (const i of this.players("offense", "line", "tightEnd")) {
      if (i === runner) continue;
      const p = this.position(i, 0);
      const away = p.x === holeX ? 0 : p.x < holeX ? -2.5 : 2.5;
      this.move(i, [{ x: p.x + side * 2 + away, y: p.y + 6 }], snap + 0.03, snap + 0.7, "out");
      script.players[i]!.act("block", snap + 0.5, { x: p.x, y: line + 10 });
    }
    const lead = this.at(S.fullback);
    if (lead != null && lead !== runner && !keeper) {
      this.move(lead, [{ x: holeX + side * 1.5, y: line + 5 }], snap + 0.04, meshTime + 0.35, "inOut");
      script.players[lead]!.act("block", meshTime + 0.35, { x: holeX, y: line + 12 });
    }
    for (const i of this.players("defense", "front")) {
      const p = this.position(i, 0);
      this.move(i, [{ x: p.x + (p.x < holeX ? -2 : 2), y: line + 1 }], snap + 0.03, snap + 0.6, "out");
    }
    // The receivers block downfield.
    for (const i of this.players("offense", "receiver")) {
      if (i === runner) continue;
      const p = this.position(i, 0);
      this.move(i, [{ x: this.ballX + (p.x - this.ballX) * 0.9, y: line + 14 }], snap + 0.05, snap + 1.1, "out");
    }
    // The linebackers fill toward the hole.
    for (const i of this.players("defense", "backer")) this.drift(i, through, 0.45, 16, snap + 0.1, meshTime + 0.45);
    this.run(runner, mesh, meshTime, new Set([qb, runner]), false, [through]);
  }

  kneel(): void {
    const qb = this.at(S.quarterback);
    if (qb == null) return;
    const { snap, line, script } = this;
    const inHand = this.snapBall(qb);
    this.carry(qb, inHand, Infinity);
    const spot = { x: this.ballX, y: Gridiron.y(this.scene?.to ?? line / 3) - 1 };
    this.move(qb, [spot], snap + 0.05, snap + 0.35, "out");
    script.players[qb]!.holds.push({ kind: "kneel", from: snap + 0.4, until: Infinity });
    this.over = snap + 0.6;
    script.end = fieldPoint(spot);
    script.stamp = snap + 0.7;
  }

  spike(): void {
    const qb = this.at(S.quarterback);
    if (qb == null) return;
    const { line, script } = this;
    const inHand = this.snapBall(qb);
    const throwAt = inHand + 0.18;
    this.carry(qb, inHand, throwAt);
    script.players[qb]!.act("spike", throwAt, { x: this.ballX, y: line });
    const p = this.position(qb, throwAt);
    this.fly(fieldPoint(p, 6), { x: p.x + 1, y: p.y + 3, z: 0 }, throwAt, 0.14, STRAIGHT);
    this.fly({ x: p.x + 1, y: p.y + 3, z: 0 }, { x: p.x + 4, y: p.y + 12, z: 0 }, throwAt + 0.14, 0.5, bounce(3), "out");
    this.over = throwAt + 0.6;
    script.end = { x: this.ballX, y: line, z: 0 };
    script.stamp = throwAt + 0.2;
  }

  /**
   * The pocket collapses: the men ESPN credits (two on a split sack), each
   * from his own slot, round the edge or up the middle, take the quarterback
   * down where the sack was spotted. A strip-sack: the stripper punches it
   * out as they get there, and the scramble for the ball follows.
   */
  sack(): void {
    const scene = this.scene;
    const qb = this.at(S.quarterback);
    if (!scene || qb == null) return;
    const { snap, line, shotgun, script } = this;
    const inHand = this.snapBall(qb);
    const pocket = { x: this.ballX, y: line - 21 };
    this.move(qb, [pocket], snap + 0.08, snap + (shotgun ? 0.55 : 0.8), "out");
    const stripped = scene.loose != null && (scene.stripper != null || scene.kind.type === "fumble");
    const down = { x: this.ballX + (scene.lane === "left" ? -6 : 6), y: Gridiron.y(scene.stopped ?? scene.loose ?? scene.to) };
    const hit = snap + 1.6;
    this.move(qb, [down], snap + 0.95, hit, "inOut");
    this.carry(qb, inHand, stripped ? hit : Infinity);
    this.decoys(new Set([qb]), snap + 1.35);
    this.protect(snap + 0.85);
    const sackers: number[] = [];
    const credits: (Participant | null)[] = scene.sackers.length === 0 ? [null] : scene.sackers.slice(0, 2);
    for (const credit of credits) {
      const i = this.man(credit, "defense", { x: this.ballX + 15, y: line }, 0, new Set(sackers), ["front"]);
      if (i != null) sackers.push(i);
    }
    sackers.forEach((sacker, k) => {
      const start = this.position(sacker, 0);
      const side = start.x >= this.ballX ? 1 : -1;
      const contact = { x: down.x + side * 3, y: down.y + 2 - k * 1.5 };
      const edge = { x: this.ballX + side * Math.max(Math.abs(start.x - this.ballX) + 6, 18), y: line - 8 };
      this.move(sacker, Math.abs(start.x - this.ballX) > 12 ? [edge, contact] : [contact], snap + 0.04, hit + k * 0.06, "inOut");
      script.players[sacker]!.act("tackle", hit + k * 0.06, down);
    });
    script.players[qb]!.holds.push({ kind: "down", from: hit + 0.12, until: Infinity });
    script.flashes.push({ beat: "hit", at: hit, point: fieldPoint(down, 3) });
    this.stop = { at: hit, point: down };
    const loose = scene.loose;
    if (stripped && loose != null) {
      // The punch at the ball as they arrive: one of the sackers, or a man of his own from his slot.
      const busy = new Set<number>([...sackers, qb]);
      const stripper = this.man(scene.stripper, "defense", down, 0, new Set([qb]));
      if (stripper != null) {
        if (!sackers.includes(stripper)) this.move(stripper, [{ x: down.x - 3, y: down.y + 3 }], snap + 0.04, hit, "inOut");
        script.players[stripper]!.actions = script.players[stripper]!.actions.filter((a) => a.kind !== "tackle");
        script.players[stripper]!.act("strip", hit, down);
        busy.add(stripper);
      }
      this.fumbled(qb, hit, { x: down.x, y: Gridiron.y(loose) }, busy);
      return;
    }
    this.over = hit + 0.2;
    script.end = fieldPoint(down);
    script.stamp = hit + 0.15;
  }

  // MARK: Kicks

  /** The long snap, the punt's arc to where it came down, and what became of it: a fair catch, a return, downed, out of bounds, a touchback. */
  punt(): void {
    const scene = this.scene;
    if (!scene) return;
    const { line, script } = this;
    const landingY = Gridiron.y(scene.turn ?? scene.from + 40);
    const outside = scene.kick === "outOfBounds";
    const landing = { x: outside ? 74 : this.ballX * 0.5 + 8, y: scene.kick === "downed" ? landingY - 14 : landingY };
    this.puntFormation({ x: landing.x * 0.5, y: landingY + 18 });
    const punter = this.at(S.punter);
    const returner = this.at(S.returner);
    if (punter == null || returner == null) return;
    const inHand = this.snapBall(punter, 3.2);
    const kickAt = inHand + 0.55;
    this.carry(punter, inHand, kickAt);
    script.players[punter]!.act("kick", kickAt, { x: this.ballX, y: line + 60 });
    const foot: FieldPoint = { x: this.ballX, y: line - 42, z: 2.5 };
    script.flashes.push({ beat: "kick", at: kickAt, point: foot });
    const d = Math.hypot(landing.x - foot.x, landing.y - foot.y);
    const caught = scene.kick === "fairCatch" || scene.kick === "returned";
    const hang = clamp(d / 88, 1.3, 2.3);
    this.fly(foot, fieldPoint(landing, caught ? 5 : 0), kickAt, hang, arc(40 + d * 0.08));
    const land = kickAt + hang;
    this.kickCoverage(kickAt, land, landing, [this.at(S.gunner(0)), this.at(S.gunner(1))].filter((i): i is number => i != null));
    this.receive(returner, landing, land, kickAt);
  }

  /** The kicker's run-up and kick from the tee, the ball's flight to where it came down (in the end zone for a touchback), and the return. */
  kickoff(): void {
    const scene = this.scene;
    if (!scene) return;
    const { snap, line, script } = this;
    const landingY = Gridiron.y(scene.turn ?? scene.from + 60);
    const landing = { x: -6, y: landingY };
    this.kickoffFormation({ x: landing.x + 4, y: landingY + 9 });
    const kicker = this.at(S.kicker);
    const returner = this.at(S.returner);
    if (kicker == null || returner == null) return;
    const tee = { x: 0, y: line };
    const kickAt = snap + 0.2;
    this.move(kicker, [{ x: -1.5, y: line - 2 }], 0.1, kickAt, "inOut");
    script.players[kicker]!.act("kick", kickAt, { x: 0, y: line + 60 });
    script.legs.push({ from: 0, until: kickAt, hand: { kind: "spot", point: fieldPoint(tee, 0.9) } });
    script.flashes.push({ beat: "kick", at: kickAt, point: fieldPoint(tee, 1) });
    const d = landing.y - tee.y;
    const caught = scene.kick === "returned" || scene.kick === "fairCatch";
    const hang = clamp(d / 95, 1.5, 2.5);
    this.fly(fieldPoint(tee, 0.9), fieldPoint(landing, caught ? 5 : 0), kickAt, hang, arc(52 + d * 0.05));
    const land = kickAt + hang;
    // Nobody moves until the ball comes down (the rule), then they go.
    for (let k = 0; k < 10; k++) {
      const i = this.at(S.cover(k));
      if (i == null) continue;
      this.drift(i, landing, 0.45, 70, land - 0.15, land + 1.2);
    }
    for (let k = 0; k < 9; k++) {
      const i = this.at(S.setup(k));
      if (i == null) continue;
      const p = this.position(i, 0);
      this.move(i, [{ x: p.x * 0.75, y: p.y + 6 }], land - 0.1, land + 0.8, "out");
    }
    this.receive(returner, landing, land, kickAt);
  }

  /** The coverage on a punt: the gunners sprint down at the snap, the line releases once it's kicked. */
  kickCoverage(kickAt: number, land: number, landing: Point, gunners: readonly number[]): void {
    const { snap, line } = this;
    for (const i of gunners) {
      const p = this.position(i, 0);
      this.move(i, [{ x: landing.x + (p.x > 0 ? 9 : -9), y: landing.y - 16 }], snap + 0.05, land + 0.1, "inOut");
    }
    for (let k = 0; k < 6; k++) {
      const i = this.at(S.lineman(k));
      if (i == null) continue;
      this.drift(i, landing, 0.45, 90, kickAt + 0.1, land + 0.6);
    }
    for (let k = 0; k < 6; k++) {
      const i = this.at(S.rusher(k));
      if (i == null) continue;
      const p = this.position(i, 0);
      this.move(i, [{ x: this.ballX + (p.x - this.ballX) * 0.8, y: line - 14 }], snap + 0.04, kickAt + 0.1, "out");
    }
    for (const slot of [S.corner(0), S.corner(1)]) {
      const i = this.at(slot);
      if (i == null) continue;
      const g = gunners.find((gunner) => this.position(gunner, 0).x > 0 === this.position(i, 0).x > 0);
      if (g == null) continue;
      this.move(i, [{ x: landing.x + (this.position(g, 0).x > 0 ? 16 : -16), y: landing.y - 6 }], snap + 0.1, land + 0.2);
    }
  }

  /** The returner under the kick: a hand up and a fair catch, a catch and a return, or he lets it go (downed, out of bounds, a touchback). */
  receive(returner: number, landing: Point, land: number, kickAt: number): void {
    const scene = this.scene;
    if (!scene) return;
    const { line, script } = this;
    switch (scene.kick) {
      case "fairCatch":
        this.move(returner, [{ x: landing.x, y: landing.y + 1 }], kickAt + 0.3, land - 0.1, "out");
        script.players[returner]!.holds.push({ kind: "fairCatch", from: land - 0.7, until: land - 0.08 });
        script.players[returner]!.act("catchHigh", land, { x: 0, y: line });
        script.flashes.push({ beat: "catchBall", at: land, point: fieldPoint(landing, 5) });
        this.carry(returner, land, Infinity);
        this.over = land + 0.3;
        script.end = fieldPoint(landing);
        script.stamp = land + 0.25;
        break;
      case "returned":
      case null:
        this.move(returner, [{ x: landing.x, y: landing.y + 1 }], kickAt + 0.3, land - 0.05, "out");
        script.players[returner]!.act("catchHigh", land, { x: 0, y: line });
        script.flashes.push({ beat: "catchBall", at: land, point: fieldPoint(landing, 5) });
        this.run(returner, landing, land + 0.06, new Set([returner]), true);
        break;
      case "downed": {
        // It lands short of him and rolls on until the coverage downs it.
        const stop = { x: landing.x - 3, y: Gridiron.y(scene.stopped ?? scene.to) };
        this.fly(fieldPoint(landing), fieldPoint(stop, 0.6), land, 0.8, bounce(3), "out");
        this.move(returner, [{ x: landing.x + 18, y: landing.y + 24 }], land - 0.6, land + 0.6, "out");
        const downer = this.nearest("offense", stop, land, ["cover"]);
        if (downer != null) {
          this.move(downer, [{ x: stop.x + 2, y: stop.y - 2 }], land - 0.2, land + 0.85);
          script.players[downer]!.act("scoop", land + 0.9, stop);
        }
        this.over = land + 0.95;
        script.end = fieldPoint(stop);
        script.stamp = land + 0.95;
        break;
      }
      case "outOfBounds": {
        const out = { x: Gridiron.half + 6, y: landing.y + 6 };
        this.fly(fieldPoint(landing), fieldPoint(out, 0.6), land, 0.5, bounce(2), "out");
        this.over = land + 0.5;
        script.end = fieldPoint(out);
        script.stamp = land + 0.5;
        break;
      }
      case "touchback": {
        const back = { x: landing.x + 2, y: Math.max(landing.y + 14, 314) };
        this.fly(fieldPoint(landing), fieldPoint(back, 0.6), land, 0.55, bounce(2), "out");
        this.move(returner, [{ x: landing.x - 6, y: landing.y + 4 }], kickAt + 0.3, land, "out");
        script.players[returner]!.holds.push({ kind: "kneel", from: land + 0.1, until: Infinity });
        this.over = land + 0.55;
        script.end = fieldPoint(back);
        script.stamp = land + 0.45;
        break;
      }
    }
  }

  /** The snap to the holder, the kicker's approach and kick, and the ball's flight through (or past) the uprights from the real spot. */
  fieldGoal(): void {
    const scene = this.scene;
    if (!scene) return;
    this.kickFormation();
    const holder = this.at(S.holder);
    const kicker = this.at(S.kicker);
    if (holder == null || kicker == null) return;
    const { snap, line, script } = this;
    const inHand = this.snapBall(holder, 1.2);
    script.players[holder]!.holds.push({ kind: "kneel", from: 0, until: Infinity });
    const ballSpot = { x: this.ballX, y: line - 21 };
    const kickAt = inHand + 0.42;
    this.carry(holder, inHand, kickAt);
    this.move(
      kicker,
      [
        { x: this.ballX - 3, y: ballSpot.y - 4 },
        { x: this.ballX - 1.2, y: ballSpot.y - 1 },
      ],
      inHand - 0.15,
      kickAt,
      "inOut",
    );
    script.players[kicker]!.act("kick", kickAt, { x: 0, y: Gridiron.backLine });
    const foot = fieldPoint(ballSpot, 0.8);
    script.flashes.push({ beat: "kick", at: kickAt, point: foot });
    // Past the posts and on: between the uprights over the bar when it's
    // good; outside an upright, or short of the bar, when it isn't.
    const miss = scene.miss;
    const past = Gridiron.backLine + 22;
    const target: FieldPoint =
      miss === "wideRight"
        ? { x: Gridiron.upright + 7, y: past, z: 12 }
        : miss === "wideLeft"
          ? { x: -Gridiron.upright - 7, y: past, z: 12 }
          : miss === "short"
            ? { x: 1, y: Gridiron.backLine - 12, z: 0 }
            : miss === "blocked"
              ? { x: this.ballX + 6, y: line - 6, z: 0 }
              : { x: 1.2, y: past, z: 14 };
    if (miss === "blocked") {
      this.block(kickAt, foot);
      return;
    }
    const d = Math.hypot(target.x - foot.x, target.y - foot.y);
    const time = clamp(0.5 + d / 190, 0.8, 1.65);
    const peak = miss === "short" ? 10 + d * 0.06 : Math.max(12, d * 0.1);
    const flight = this.fly(foot, target, kickAt, time, arc(peak));
    if (miss !== "short") {
      // On into the net behind the posts, and put away.
      this.fly(target, { x: target.x * 1.2, y: target.y + 14, z: 0 }, kickAt + time, 0.35, STRAIGHT);
      script.ballGone = kickAt + time + 0.3;
    }
    if (miss !== "short") {
      // Crossing the end line: the crossbar's moment.
      const f = script.flights[flight]!;
      const u = (Gridiron.backLine - foot.y) / Math.max(target.y - foot.y, 1);
      const at = kickAt + time * clamp(u, 0, 1);
      script.score = at;
      script.scorePoint = f.point(at);
    }
    // The rush: the line surges, the middle leaps.
    for (let k = 0; k < 9; k++) {
      const i = this.at(S.rusher(k));
      if (i == null) continue;
      const p = this.position(i, 0);
      this.move(i, [{ x: this.ballX + (p.x - this.ballX) * 0.9, y: line - 3 }], snap + 0.03, snap + 0.6, "out");
    }
    this.over = kickAt + time;
    script.end = fieldPoint(ground(target));
    script.stamp = (script.score ?? kickAt + time) + 0.1;
  }

  /**
   * A kick blocked at the line: the man ESPN credits (the rusher on his
   * slot's side) comes through and goes up, both arms high, the ball off his
   * hands a beat after it's kicked, and away behind the line, bouncing.
   */
  block(kickAt: number, foot: FieldPoint): void {
    const scene = this.scene;
    if (!scene) return;
    const { snap, line, ballX, script } = this;
    const rushers = this.players("defense", "front");
    const slot = scene.blocker?.slot;
    const lane = slot != null ? new DepthSlot(slot, [], true, null).lane : null;
    const side = Builder.sign(lane);
    const sided = side === 0 ? rushers : rushers.filter((i) => (this.position(i, 0).x - ballX) * side > 0);
    const aim = { x: ballX + side * 6, y: line };
    let blocker: number | null = null;
    for (const i of sided.length === 0 ? rushers : sided) {
      if (blocker == null || hypotP(this.position(i, 0), aim) < hypotP(this.position(blocker, 0), aim)) blocker = i;
    }
    if (blocker == null) return;
    const from = this.position(blocker, 0);
    const through = { x: ballX + clamp(from.x - ballX, -7, 7), y: line - 2 };
    const hands: FieldPoint = { x: through.x, y: through.y - 1, z: 8.5 };
    const meets = kickAt + 0.14;
    this.move(blocker, [through], snap + 0.03, meets - 0.04, "out");
    script.players[blocker]!.act("leap", meets, ground(foot));
    this.fly(foot, hands, kickAt, meets - kickAt, arc(1.2));
    script.flashes.push({ beat: "deflect", at: meets, point: hands });
    const away = through.x >= ballX ? 1 : -1;
    const landing = { x: through.x + away * 12, y: line - 16 };
    this.fly(hands, fieldPoint(landing, 0.6), meets, 0.85, bounce(2), "out");
    for (let k = 0; k < 9; k++) {
      const i = this.at(S.rusher(k));
      if (i == null || i === blocker) continue;
      const p = this.position(i, 0);
      this.move(i, [{ x: ballX + (p.x - ballX) * 0.9, y: line - 3 }], snap + 0.03, snap + 0.6, "out");
    }
    this.over = meets + 0.85;
    script.end = fieldPoint(landing);
    script.stamp = meets + 0.5;
  }

  // MARK: Flags

  /**
   * A flag that stopped the snap: the man flagged moves early, the nearest
   * official's flag comes in on him, the players straighten up, and the
   * yards are walked off; the ball is never snapped.
   */
  penalty(): void {
    const scene = this.scene;
    const ruling = this.ruling;
    if (!scene || !ruling) return;
    const { line, ballX, script } = this;
    script.legs.push({ from: 0, until: 0, hand: { kind: "spot", point: this.spot } });
    const onDefense = scene.to >= scene.from;
    const lands = 1;
    const thrown = ruling.flags.filter((f) => f.timing === "beforeSnap" || ruling.flags.every((g) => g.timing !== "beforeSnap"));
    (thrown.length === 0 ? [null] : thrown).forEach((flag, k) => {
      const team: Team = flag?.side != null ? (flag.side === ruling.offense ? "offense" : "defense") : onDefense ? "defense" : "offense";
      let at = { x: ballX + (team === "defense" ? 9 : -9), y: line + (team === "defense" ? 4 : -4) };
      const fouler = this.man(flag?.player, team, ground(this.spot), 0);
      if (fouler != null && flag?.player != null) {
        // Out of his stance a beat early, a lurch, and back.
        const here = this.position(fouler, 0);
        const way = team === "offense" ? 1 : -1;
        this.move(fouler, [{ x: here.x, y: here.y + 1.6 * way }], 0.42, 0.55, "out");
        this.move(fouler, [here], 0.75, 1.2);
        script.players[fouler]!.set = Math.min(script.players[fouler]!.set ?? 0.42, 0.42);
        at = { x: here.x + 2, y: here.y + 1.6 * way };
      }
      this.throwFlag(at, lands + k * 0.2, flag?.status === "declined", true);
    });
    for (const p of script.players) p.set = Math.min(p.set ?? lands, lands + 0.15);
    this.walk(line, Gridiron.y(scene.to), lands + 0.45, true);
  }

  /**
   * The flags on a play that ran, each when and where its foul happened,
   * on the man flagged (from the nearest official, the play going on round
   * it): a hold mid-play, interference as the ball arrives, roughing the
   * passer just after the throw, a horse collar or a face mask at the
   * tackle, an offside at the snap, one after the whistle once it's over.
   * Then the yards walked off, from where it was enforced to where it put
   * the ball; a declined flag only says so, offsetting ones walk nothing off.
   */
  flags(): void {
    const ruling = this.ruling;
    if (!ruling || ruling.flags.length === 0) return;
    const { script, snap } = this;
    let walked: SceneFlag | null = null;
    for (const flag of ruling.flags) {
      const foul = this.moment(flag);
      const team: Team = flag.side === ruling.offense ? "offense" : "defense";
      const fouler = flag.player ? this.man(flag.player, team, foul.near, foul.at) : null;
      let place = fouler != null ? this.position(fouler, foul.at) : foul.near;
      if (foul.fixed) {
        // Where it happened (the catch point, the passer, the tackle), and the man flagged in on it.
        place = foul.near;
        if (fouler != null && hypotP(this.position(fouler, foul.at), place) > 4) {
          const from = Math.max(foul.at - 0.9, snap + 0.04);
          this.move(fouler, [{ x: place.x + 2.5, y: place.y + 2 }], from, foul.at, "inOut");
        }
        const qb = this.at(S.quarterback);
        if (fouler != null && foul.late && qb != null) {
          // Roughing the passer: the hit after the ball's gone.
          script.players[fouler]!.act("tackle", foul.at + 0.04, place);
          if (!script.players[qb]!.holds.some((h) => h.kind === "knocked")) script.players[qb]!.holds.push({ kind: "knocked", from: foul.at + 0.12, until: Infinity });
          script.flashes.push({ beat: "hit", at: foul.at + 0.04, point: fieldPoint(place, 4) });
        }
      }
      this.throwFlag({ x: place.x + 2.5, y: place.y - 2 }, foul.at + 0.5, flag.status === "declined", Math.abs(foul.at - snap - 0.25) < 0.01);
      if (flag.status === "accepted" && walked == null) walked = flag;
    }
    const end = Gridiron.y(ruling.to);
    const ended = script.end?.y ?? end;
    if (!walked || !(Math.abs(end - ended) > 0.5)) return;
    const from = walked.from != null ? Gridiron.y(walked.from) : ended;
    const lands = Math.max(script.flags.length > 0 ? Math.max(...script.flags.map((f) => f.lands)) : this.over, this.over);
    // The ball goes to the official's spot, then walks.
    const ball = script.ball(lands);
    if (ball && (Math.abs(ball.y - from) > 1 || Math.abs(ball.x - this.ballX) > 1)) this.fly(ball, { x: this.ballX, y: from, z: 0.6 }, lands + 0.25, 0.45, arc(5));
    this.walk(from, end, lands + 0.85, false);
  }

  /**
   * When and near where a foul happened, by what it was (its slug, or its
   * name); `fixed` when it happened at a place of its own (the catch point,
   * the passer, the tackle), not wherever the man flagged is; `late` for a
   * hit on the passer after the throw.
   */
  moment(flag: SceneFlag): { at: number; near: Point; fixed: boolean; late: boolean } {
    const key = (flag.slug ?? flag.name).toLowerCase().replaceAll(" ", "-");
    const { script, snap } = this;
    const end = this.stop ?? { at: this.over, point: script.end ? ground(script.end) : ground(this.spot) };
    const ballAt = (t: number): Point => {
      const b = script.ball(t);
      return b ? ground(b) : ground(this.spot);
    };
    const qb = this.at(S.quarterback);
    if (flag.timing === "afterPlay") return { at: this.over + 0.35, near: end.point, fixed: true, late: false };
    if (key.includes("interference") && this.arrival) return { at: this.arrival.at - 0.05, near: this.arrival.point, fixed: true, late: false };
    if (key.includes("roughing-the-passer") && this.release != null && qb != null) return { at: this.release + 0.15, near: this.position(qb, this.release + 0.15), fixed: true, late: true };
    if (["grounding", "illegal-forward"].some((k) => key.includes(k)) && this.release != null && qb != null) {
      return { at: this.release + 0.1, near: this.position(qb, this.release + 0.1), fixed: true, late: false };
    }
    const atTheStop = ["horse-collar", "face-mask", "facemask", "unnecessary-roughness", "targeting", "tripping", "personal-foul", "roughing", "unsportsmanlike", "late-hit", "leverage", "lowering"];
    if (atTheStop.some((k) => key.includes(k))) return { at: end.at, near: end.point, fixed: true, late: false };
    const atTheSnap = ["offside", "encroachment", "neutral-zone", "illegal-shift", "illegal-motion", "illegal-formation", "false-start", "too-many", "substitution", "delay"];
    if (atTheSnap.some((k) => key.includes(k))) return { at: snap + 0.25, near: ground(this.spot), fixed: false, late: false };
    // A hold, a block in the back, illegal hands: while the play goes on, at the point of attack (in the pocket before a
    // throw, as the back hits the hole, as the returner sets off).
    let carried: number | null = null;
    for (let i = script.legs.length - 1; i >= 0; i--) {
      const leg = script.legs[i]!;
      if (leg.hand.kind === "carry" && !Number.isFinite(leg.until)) {
        carried = leg.from;
        break;
      }
    }
    const mid = this.release != null ? snap + (this.release - snap) * 0.6 : carried != null ? carried + clamp((end.at - carried) * 0.25, 0.1, 0.5) : snap + 0.9;
    return { at: Math.min(mid, end.at), near: ballAt(mid), fixed: false, late: false };
  }

  /** An official's flag, thrown at the foul: from the official nearest it (at his post since the snap), end over end to the spot. */
  throwFlag(spot: Point, lands: number, declined = false, wing = false): void {
    const thrown = lands - 0.45;
    const thrower = this.official(spot, wing);
    const hand = this.position(thrower, thrown);
    this.script.players[thrower]!.act("flagThrow", thrown, spot);
    this.script.flags.push({ thrown, lands, from: fieldPoint(hand, 6.5), to: spot, declined });
    this.script.flashes.push({ beat: "flag", at: lands, point: fieldPoint(spot) });
  }

  /**
   * The official nearest a spot, at his post: the referee behind the
   * backfield, the umpire (the NFL's, in it), the line judge and the head
   * linesman on the sidelines at the line, the back judge deep; a foul at
   * the line (`wing`) is the sideline officials'. Added the first time one
   * throws.
   */
  official(p: Point, wing = false): number {
    const { line, ballX, script } = this;
    const sides = [
      { x: -Gridiron.half - 3, y: line },
      { x: Gridiron.half + 3, y: line },
    ];
    const posts = wing
      ? sides
      : [
          { x: ballX + 16, y: line - 40 },
          { x: ballX - 12, y: line - 33 },
          ...sides,
          { x: ballX + 6, y: line + 75 },
        ];
    let post = posts[0]!;
    for (const q of posts) if (hypotP(q, p) < hypotP(post, p)) post = q;
    const i = script.players.findIndex((pl) => pl.team === "official" && pl.at.x === post.x && pl.at.y === post.y);
    if (i >= 0) return i;
    script.players.push(new Player("official", post, "official"));
    return script.players.length - 1;
  }

  /** The ball slides from one spot to the other; with `moving`, the players walk with it. */
  walk(from: number, to: number, start: number, moving: boolean): void {
    // At a walk.
    const time = clamp(Math.abs(to - from) / 16, 0.8, 1.8);
    this.script.march = { from, to, start, end: start + time };
    this.script.legs.push({ from: start, until: start + time, hand: { kind: "slide", from: { x: this.ballX, y: from, z: 0.6 }, to: { x: this.ballX, y: to, z: 0.6 } } });
    if (moving) {
      this.script.players.forEach((_, i) => {
        const p = this.position(i, start);
        this.move(i, [{ x: p.x, y: p.y + to - from }], start, start + time);
      });
    }
    this.over = start + time;
    this.script.end = { x: this.ballX, y: to, z: 0 };
    this.script.stamp = start + time + 0.05;
  }

  // MARK: End and settle

  /** The action ends when the last thing stops; the stamp lands as it resolves; the lines move to the new spot with it. */
  finish(): void {
    const scene = this.ruling;
    if (!scene) return;
    const { script } = this;
    script.legs = script.legs.map((leg, i) => ({ leg, i })).sort((a, b) => a.leg.from - b.leg.from || a.i - b.i).map(({ leg }) => leg);
    if (!Number.isFinite(script.stamp)) script.stamp = Math.max(this.over, this.snap + 0.6);
    // The stamp holds a beat on the play before the field settles (a try's beat is shorter).
    const hold = scene.pointAfter == null ? 0.35 : 0.3;
    // (`?? 0` on an empty list: the Swift's max() of nothing.)
    const ends = [
      script.stamp + hold,
      this.over,
      (script.flashes.length > 0 ? Math.max(...script.flashes.map((f) => f.at)) : 0) + 0.4,
      script.flights.length > 0 ? Math.max(...script.flights.map((f) => f.end)) : 0,
    ];
    script.settle = Math.max(Math.max(...ends), 1.2) + hold;
    // No lines on a kickoff: there's no line of scrimmage yet.
    script.lines = scene.kind.type === "kickoff" ? NO_LINES : { scrimmage: this.line, gain: yards(scene.gainBefore) };
    script.next = { scrimmage: scene.scoring == null && !this.isKick ? Gridiron.y(scene.to) : null, gain: yards(scene.gainAfter) };
    if (this.isKick && scene.scoring == null && (scene.kind.type === "punt" || scene.kind.type === "kickoff")) {
      script.next = { scrimmage: Gridiron.y(scene.to), gain: yards(scene.gainAfter) };
    }
    // After a try, the next snap is the kickoff's: no lines.
    if (scene.pointAfter != null) script.next = NO_LINES;
    script.linesMove = script.stamp - 0.05;
  }

  get isKick(): boolean {
    switch (this.scene?.kind.type) {
      case "punt":
      case "kickoff":
      case "fieldGoal":
      case "extraPoint":
        return true;
      default:
        return false;
    }
  }

  /**
   * The headline for a marquee play, landing with its payoff: the ball
   * crossing the goal line, the kick over the bar, the pick, the recovery.
   * A gain, an incompletion and a punt keep to the stamp.
   */
  headline(): void {
    // A try keeps to its stamp: the touchdown had the headline.
    const scene = this.ruling;
    if (!scene || scene.pointAfter != null) return;
    const { script } = this;
    const banner = (text: string, tone: Banner["tone"], at: number, confetti = false) => {
      script.banner = { text, tone, at, until: Math.max(script.settle, at + 1.4), confetti };
    };
    let catchAt: number | null = null;
    for (let i = script.flashes.length - 1; i >= 0; i--) {
      if (script.flashes[i]!.beat === "catchBall") {
        catchAt = script.flashes[i]!.at;
        break;
      }
    }
    const k = scene.kind;
    if (scene.scoring === "touchdown" && k.type === "interception") {
      banner("PICK SIX", { kind: "side", side: scene.scorer }, script.score ?? script.stamp, true);
    } else if (scene.scoring === "touchdown") {
      banner("TOUCHDOWN", { kind: "side", side: scene.scorer }, script.score ?? script.stamp, true);
    } else if (scene.scoring === "safety") {
      banner("SAFETY", { kind: "side", side: scene.scorer }, script.stamp);
    } else if (kindIs(k, "fieldGoal", true)) {
      banner("FIELD GOAL", { kind: "side", side: scene.offense }, script.score ?? script.stamp);
    } else if (kindIs(k, "fieldGoal", false)) {
      banner(scene.miss === "blocked" ? "BLOCKED" : "NO GOOD", { kind: "neutral" }, script.score ?? script.stamp);
    } else if (k.type === "interception") {
      banner("INTERCEPTION", { kind: "neutral" }, (catchAt ?? script.stamp) + 0.05);
    } else if (k.type === "fumble") {
      banner("FUMBLE", { kind: "neutral" }, this.recoveredAt ?? script.stamp - 0.1);
    } else if (scene.onDowns) {
      banner("TURNOVER ON DOWNS", { kind: "neutral" }, script.stamp);
    }
  }

  /**
   * The stamp's corner, measured from its type: the code at a fifth of the
   * view's height, the title under it at about an eighteenth, in a view
   * twice as wide as tall.
   */
  measureStamp(): void {
    const scene = this.ruling;
    if (!scene) return;
    const stamp = footballStamp(scene);
    if (stamp.parts.length === 0) return;
    // Each part's glyphs (the tag at 0.42 of the number's size) and the space after it.
    let code = 0;
    for (const part of stamp.parts) {
      let width = 0;
      for (const c of part.text) width += /\p{N}/u.test(c) ? 0.6 : c === "+" || c === "−" ? 0.62 : 0.7;
      code += width * (part.heavy ? 1 : 0.42) + 0.16;
    }
    const title = Math.min([...stamp.title].length * 0.72 * 0.28, 3.4);
    const width = 0.055 + Math.max(code, title) * 0.2;
    this.script.corner = { width: width / CameraFrame.aspect + 0.03, height: 0.3 };
  }

  /**
   * After the hold: on a new down both teams jog back to the new line and
   * the ball is spotted there; after a score, a kick or a change of
   * possession they stay where it ended.
   */
  settle(): void {
    const scene = this.ruling;
    if (!scene) return;
    const { script } = this;
    const s = script.settle;
    const back = s + 0.75;
    const reform = scene.scoring == null && !scene.flips && !this.isKick && scene.pointAfter == null;
    if (reform) {
      const to = Gridiron.y(scene.to);
      const dy = to - this.line;
      for (const player of script.players) {
        const home = player.at;
        player.move([{ x: home.x, y: home.y + dy }], s, back);
        player.holds = player.holds.map((h) => ({ ...h, until: Math.min(h.until, s) }));
        if (player.set != null) player.resets = back;
      }
      const ball = script.ball(s);
      if (ball) this.fly(ball, { x: this.ballX, y: to, z: 0.6 }, s + 0.1, 0.6, arc(6));
      script.legs = script.legs.map((leg, i) => ({ leg, i })).sort((a, b) => a.leg.from - b.leg.from || a.i - b.i).map(({ leg }) => leg);
    }
    script.duration = reform ? back : s + (scene.pointAfter == null ? 0.3 : 0.1);
  }

  // MARK: Camera

  /**
   * Cuts the play into shots: the formation from behind the offense for
   * the snap; the ball in the air with the man going for it; the ball
   * carrier with the men closing on him; then the end spot and the new
   * line to gain, where it rests.
   */
  shoot(): void {
    const scene = this.ruling;
    if (!scene) return;
    const { script, snap, line } = this;
    const everyone = script.players.flatMap((p, i) => (p.team !== "official" ? [i] : []));
    const returner = this.at(S.returner);
    const deep = this.at(S.deep);
    const opening =
      scene.kind.type === "punt" ? everyone.filter((i) => i !== returner) : scene.kind.type === "kickoff" ? everyone.filter((i) => i !== returner && i !== deep) : everyone;
    const points: FieldPoint[] = [this.spot];
    const gainBefore = yards(scene.gainBefore);
    if (gainBefore != null && gainBefore - line < 45) points.push({ x: this.ballX, y: gainBefore, z: 0 });
    const shots: Shot[] = [shot(0, { actors: opening, points, closest: 60, at: 0 })];
    const lastFrom = () => shots[shots.length - 1]?.from ?? 0;
    // The ball's flights (the snap's aside): each followed with whoever's going for it.
    script.flights.forEach((f, i) => {
      if (!(f.end - f.start > 0.3 && f.start > snap + 0.1 && f.start < this.over)) return;
      let near: number | null = null;
      let best = Infinity;
      for (const a of everyone) {
        const d = hypotP(this.position(a, f.end), f.to);
        if (d < best) {
          best = d;
          near = a;
        }
      }
      const kept = script.yaw === 0 ? Builder.posts : [];
      shots.push(shot(Math.max(f.start - 0.3, lastFrom() + 0.25), { flight: i, actors: near != null ? [near] : [], points: kept, closest: f.to.y - f.from.y > 90 ? 80 : 55 }));
    });
    // The ball carrier, from when he has it, with the men closing on him.
    let carry: Leg | null = null;
    for (let i = script.legs.length - 1; i >= 0; i--) {
      const leg = script.legs[i]!;
      if (leg.hand.kind === "carry" && !Number.isFinite(leg.until)) {
        carry = leg;
        break;
      }
    }
    if (carry && carry.hand.kind === "carry" && carry.from < this.over) {
      const runner = carry.hand.player;
      const closing = script.players.flatMap((p, i) => (p.actions.some((a) => a.kind === "tackle") ? [i] : []));
      shots.push(shot(Math.max(carry.from, lastFrom() + 0.25), { actors: [runner, ...closing], points: script.end ? [script.end] : [], closest: 75 }));
    }
    // A flag thrown while the play goes on: where it lands is in frame as it comes down.
    for (const flag of script.flags) {
      if (!(flag.lands < this.over)) continue;
      let k = -1;
      for (let i = shots.length - 1; i >= 0; i--) {
        if (shots[i]!.from <= flag.thrown - 0.2) {
          k = i;
          break;
        }
      }
      if (k < 0) continue;
      const flagged: Shot = { ...shots[k]!, from: flag.thrown - 0.2, points: [...shots[k]!.points, fieldPoint(flag.to)] };
      const resumed: Shot = { ...shots[k]!, from: flag.lands + 0.5 };
      const next = k + 1 < shots.length ? shots[k + 1]!.from : Infinity;
      shots.splice(k + 1, 0, flagged);
      if (resumed.from < next) shots.splice(k + 2, 0, resumed);
    }
    // A flag's walk: both spots.
    const march = script.march;
    if (march) {
      shots.push(
        shot(Math.max(march.start - 0.3, lastFrom() + 0.25), {
          points: [
            { x: this.ballX - 24, y: march.from, z: 0 },
            { x: this.ballX + 24, y: march.from, z: 0 },
            { x: this.ballX - 24, y: march.to, z: 0 },
            { x: this.ballX + 24, y: march.to, z: 0 },
          ],
          closest: 60,
        }),
      );
    }
    // The end: the spot and the new line to gain.
    let ending: FieldPoint[] = script.end ? [script.end] : [];
    // The lines where they cross the field by the spot.
    const across = clamp(script.end?.x ?? 0, -Gridiron.half, Gridiron.half);
    if (script.next.scrimmage != null) ending.push({ x: across - 18, y: script.next.scrimmage, z: 0 }, { x: across + 18, y: script.next.scrimmage, z: 0 });
    const gain = script.next.gain;
    if (gain != null && Math.abs(gain - (script.next.scrimmage ?? gain)) < 45) ending.push({ x: across, y: gain, z: 0 });
    if ((scene.scoring === "fieldGoal" || this.isKick) && scene.kind.type !== "punt" && scene.kind.type !== "kickoff") ending = [...Builder.posts, ...ending];
    const scorePoint = script.scorePoint;
    if (scene.scoring === "touchdown" && scene.pointAfter == null && scorePoint) {
      // Room above the goal line for the fireworks.
      ending.push({ x: scorePoint.x - 30, y: scorePoint.y, z: 30 }, { x: scorePoint.x + 30, y: scorePoint.y, z: 30 });
    }
    const lastLeg = script.legs[script.legs.length - 1];
    const carrier = lastLeg?.hand.kind === "carry" ? lastLeg.hand.player : null;
    const endFrom = Math.min(Math.max(script.stamp - 0.4, lastFrom() + 0.3), script.settle - 0.2);
    shots.push(shot(endFrom, { actors: carrier != null ? [carrier] : [], points: ending, closest: 60 }));
    script.shots = shots;

    const restRegion = this.restRegion();
    const banner: [number, number] | null = script.banner ? [script.banner.at, script.banner.until] : null;
    // The camera keeps a little more than the stamp's corner clear: a man running into it is out of it again
    // before the camera, a beat behind, has caught up.
    const corner = { width: script.corner.width + 0.03, height: script.corner.height + 0.04 };
    const stamp = script.stamp;
    /** Everyone in view, now and a beat ahead (the camera is a beat behind). */
    const visible = (t: number): Rect[] => {
      const out: Rect[] = [];
      for (const p of script.players) {
        if (!(p.opacity(t) > 0.5)) continue;
        for (const u of [t, t + 0.4]) out.push(script.room(fieldPoint(p.position(u)), true));
      }
      return out;
    };
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
        const previous = shots[k - 1]!;
        const before = shotRegion(previous, script, t);
        const a = unionAll(before);
        if (a) {
          const blend = CameraRig.blend(a, region, t - s.from);
          if (blend.u < 1) {
            region = blend.region;
            closest = previous.closest + (closest - previous.closest) * blend.u;
            items = [...items, ...before];
          }
        }
      }
      const headroom = CameraRig.headroom(t, banner);
      if (!Number.isFinite(stamp) || t < stamp - 0.3) return CameraFrame.fit(region, headroom, closest);
      // The stamp never sits on anyone in view, in the play or not (a pile trailing it, a man
      // jogging back to the line).
      const others = visible(t);
      if (!(t > script.settle)) return clearing(region, items, others, headroom, closest, corner);
      // Settled: on to where it rests, keeping the corner clear of everyone on the way.
      return clearing(
        restRegion,
        others.filter((r) => intersects(restRegion, r)),
        others,
        headroom,
        60,
        corner,
      );
    };
    const rest = this.restFrame();
    // Followed until everyone is back in place, then an eased move the last of the way to the rest
    // framing, as long as the camera's caps need (an eased move peaks at one and a half times its
    // average speed).
    const followed = script.duration;
    const samples = CameraRig.follow(followed, goal);
    const last = samples[samples.length - 1] ?? rest;
    const pan = Math.hypot(last.x - rest.x, last.y - rest.y) / Math.min(last.span, rest.span);
    const zoom = Math.log(rest.span / last.span);
    const glide = Math.max(0.4, (1.5 * pan) / 1.25, (1.5 * Math.abs(zoom)) / (zoom > 0 ? 2 : 1));
    script.duration = Math.max(followed + glide, (script.banner?.until ?? 0) + 0.3);
    script.camera = new CameraPath(rest, samples, followed, followed + glide);
  }

  /** The goalposts at the far end: the base, the crossbar, the tops of the uprights. */
  static readonly posts: readonly FieldPoint[] = [
    { x: 0, y: Gridiron.backLine, z: 0 },
    { x: -Gridiron.upright, y: Gridiron.backLine, z: 30 },
    { x: Gridiron.upright, y: Gridiron.backLine, z: 30 },
  ];

  /** What the camera rests on: everyone where they stand at the end, and the lines. */
  restRegion(): Rect {
    const { script } = this;
    const scene = this.ruling;
    const t = script.duration + 1;
    let items = script.players.filter((p) => p.opacity(t) > 0.5).map((p) => script.room(fieldPoint(p.position(t)), true));
    const reform = scene ? scene.scoring == null && !scene.flips && !this.isKick : true;
    if (!reform) {
      // After a score, a kick or a turnover: the end of it, not the whole field.
      const end = script.end ?? this.spot;
      items = items.filter((r) => Math.abs(midX(r) - end.x) < 70 && Math.abs(r.y + 3 - end.y * 0.5) < 45);
      items.push(script.room(end, true));
      if (scene?.scoring === "fieldGoal" || scene?.kind.type === "fieldGoal") items.push(...Builder.posts.map((p) => script.room(p, false)));
    }
    for (const line of [script.next.scrimmage, script.next.gain]) {
      if (line != null) items.push(script.room({ x: this.ballX, y: line, z: 0 }, false));
    }
    return unionAll(items) ?? script.room(this.spot, true);
  }

  restFrame(): CameraFrame {
    const { script } = this;
    const t = script.duration + 1;
    const region = this.restRegion();
    const items = script.players.filter((p) => p.opacity(t) > 0.5).map((p) => script.room(fieldPoint(p.position(t)), true));
    // The stamp sits on nobody at rest.
    return clearing(
      region,
      items.filter((r) => intersects(region, r)),
      items,
      CameraFrame.headroom,
      60,
      script.corner,
    );
  }
}

const yards = (yard: number | null): number | null => (yard != null ? Gridiron.y(yard) : null);

// MARK: - Shots

/** One shot of the broadcast: from when, and what it keeps in frame. */
export interface Shot {
  readonly from: number;
  /** A flight's ball, now and a beat ahead, and its shadow. */
  readonly flight: number | null;
  /** Players by index, now and a beat ahead. */
  readonly actors: readonly number[];
  /** Fixed spots: the goalposts, a line. */
  readonly points: readonly FieldPoint[];
  /** No closer than this (feet top to bottom). */
  readonly closest: number;
  /** A cut, not a move. */
  readonly cut: boolean;
  /** Players framed where they stood at this moment (the formation), not as they move. */
  readonly at: number | null;
}

export function shot(from: number, options: Partial<Omit<Shot, "from">> = {}): Shot {
  return { from, flight: options.flight ?? null, actors: options.actors ?? [], points: options.points ?? [], closest: options.closest ?? 60, cut: options.cut ?? false, at: options.at ?? null };
}

/** What a shot keeps in frame at t: each figure's or ball's room. */
export function shotRegion(s: Shot, script: FootballScript, t: number): Rect[] {
  const items = s.points.map((p) => script.room(p, p.z === 0));
  if (s.flight != null && s.flight < script.flights.length) {
    const f = script.flights[s.flight]!;
    for (const dt of [0, 0.2, 0.45]) {
      const p = f.point(Math.min(Math.max(t + dt, f.start), f.end));
      items.push(script.room(p, false));
      items.push(script.room(fieldPoint(ground(p)), false));
    }
  }
  for (const index of s.actors) {
    const player = script.players[index];
    if (!player) continue;
    if (s.at != null) {
      items.push(script.room(fieldPoint(player.position(s.at)), true));
      continue;
    }
    for (const dt of [0, 0.25]) {
      if (player.opacity(t + dt) > 0.5) items.push(script.room(fieldPoint(player.position(t + dt)), true));
    }
  }
  return items;
}

// MARK: - Stamp

/**
 * The stamp for a play, low on the left as it resolves: the number big and
 * heavy in the play's color ("+12", "−7", "INC", "FG 47 ✓"), a tag lighter
 * beside it ("1ST DOWN", "SACK", "TD"), the play in small capitals under it.
 * (pure; tested)
 */
export interface FootballStamp {
  readonly parts: readonly { readonly text: string; readonly heavy: boolean }[];
  readonly title: string;
  /** gain: the offense's color; score: the scoring team's; loss: the app's red (a sack, a turnover); flag: a flag's yellow. */
  readonly tone: "gain" | "score" | "loss" | "flag" | "neutral";
  /** A miss's ✗ in red, beside its kick. */
  readonly missed: boolean;
}

export function footballStamp(scene: FootballScene): FootballStamp {
  const yardsText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
  const names = scene.names;
  const titled = (...words: (string | null | undefined)[]) => words.filter((w): w is string => w != null && w !== "").join(" · ");
  let way: string | null = null;
  if (scene.depth && scene.lane) way = `${scene.depth === "deep" ? "Deep" : "Short"} ${scene.lane}`;
  else if (scene.depth == null && scene.lane && scene.gap) way = scene.gap === "middle" ? "up the middle" : `${scene.lane} ${scene.gap}`;
  const thrown = [way, names.target != null ? `to ${names.target}` : null].filter((x): x is string => x != null).join(" ");
  const td = scene.scoring === "touchdown";
  let parts: { text: string; heavy: boolean }[] = [];
  let title = "";
  let tone: FootballStamp["tone"] = "neutral";
  let missed = false;
  const k = scene.kind;
  // A try: "XP ✓" by the kicker, "2-PT ✓" by whoever ran or caught it (the NFL's terms).
  const tried = scene.pointAfter;
  if (tried != null) {
    const good = tried === "kick" ? kindIs(k, "extraPoint", true) : td;
    parts = [
      { text: tried === "kick" ? "XP" : "2-PT", heavy: false },
      { text: good ? "✓" : "✗", heavy: true },
    ];
    const how = tried === "pass" ? (names.target != null ? `to ${names.target}` : null) : scene.gap ? (scene.gap === "middle" ? "up the middle" : `${scene.lane ?? "middle"} ${scene.gap}`) : null;
    title = tried === "kick" ? (names.lead ?? "") : [names.lead ?? null, how].filter((x): x is string => x != null).join(tried === "pass" ? " " : ", ");
    return { parts, title, tone: good ? "score" : "neutral", missed: !good };
  }
  const offsetting = scene.flags.length > 1 && scene.flags.every((f) => f.status === "offsetting");
  switch (offsetting ? "offsetting" : k.type) {
    case "offsetting":
      // Offsetting fouls: the down is played again.
      parts = [{ text: "NO PLAY", heavy: true }];
      title = "Offsetting penalties";
      tone = "flag";
      break;
    case "pass":
      parts = [{ text: yardsText(scene.yards), heavy: true }];
      title = thrown;
      tone = td ? "score" : scene.yards > 0 ? "gain" : "neutral";
      break;
    case "rush":
    case "other":
      parts = k.type === "other" && scene.yards === 0 ? [] : [{ text: yardsText(scene.yards), heavy: true }];
      title = [names.lead ?? null, way].filter((x): x is string => x != null).join(", ");
      tone = td ? "score" : scene.yards > 0 ? "gain" : "neutral";
      break;
    case "incomplete":
      parts = [{ text: "INC", heavy: true }];
      title = thrown;
      break;
    case "sack":
      parts = [
        { text: yardsText(scene.yards), heavy: true },
        { text: "SACK", heavy: false },
      ];
      title = names.stop != null ? `By ${names.stop}` : "";
      tone = "loss";
      break;
    case "kneel":
      parts = [
        { text: yardsText(scene.yards), heavy: true },
        { text: "KNEEL", heavy: false },
      ];
      break;
    case "spike":
      parts = [
        { text: "INC", heavy: true },
        { text: "SPIKE", heavy: false },
      ];
      break;
    case "interception":
      parts = [{ text: "INT", heavy: true }];
      title = titled(names.taker, scene.yards > 0 && !td ? `${scene.yards} yd return` : null);
      tone = td ? "score" : "loss";
      break;
    case "fumble":
      parts = [{ text: "FUMBLE", heavy: true }];
      title = titled(names.taker != null ? `Recovered by ${names.taker}` : null);
      tone = td ? "score" : "loss";
      break;
    case "punt":
      parts = [
        { text: "PUNT", heavy: false },
        { text: `${scene.kickYards ?? Math.abs(Math.trunc(scene.to - scene.from))}`, heavy: true },
      ];
      title = kickTitle(scene);
      break;
    case "kickoff": {
      const back = scene.returnYards;
      if (back != null && (back !== 0 || td)) {
        parts = [
          { text: yardsText(back), heavy: true },
          { text: "RETURN", heavy: false },
        ];
        tone = td ? "score" : "neutral";
        title = names.returner ?? "";
      } else {
        parts = [
          { text: "KICK", heavy: false },
          { text: `${scene.kickYards ?? 0}`, heavy: true },
        ];
        title = kickTitle(scene);
      }
      break;
    }
    case "fieldGoal": {
      const good = kindIs(k, "fieldGoal", true);
      parts = [
        { text: "FG", heavy: false },
        { text: `${scene.kickYards ?? Math.trunc(117 - scene.from)}`, heavy: true },
        { text: good ? "✓" : "✗", heavy: true },
      ];
      title = titled(names.lead, good ? null : missWord(scene.miss));
      tone = good ? "score" : "neutral";
      missed = !good;
      break;
    }
    case "extraPoint": {
      const good = kindIs(k, "extraPoint", true);
      parts = [
        { text: "XP", heavy: false },
        { text: good ? "✓" : "✗", heavy: true },
      ];
      tone = good ? "score" : "neutral";
      missed = !good;
      break;
    }
    case "penalty": {
      const gained = rounded(scene.to - scene.from);
      parts = [
        { text: yardsText(gained === 0 ? scene.yards : gained), heavy: true },
        { text: "FLAG", heavy: false },
      ];
      const flag = scene.flags.find((f) => f.status === "accepted") ?? scene.flags[0] ?? null;
      const name = scene.penalty?.name;
      title = titled(name != null ? announced(name, flag?.side ?? null, scene.offense) : null, scene.penalty?.noPlay === true ? "No play" : null);
      tone = "flag";
      break;
    }
  }
  if (td) {
    parts.push({ text: "TD", heavy: false });
  } else if (scene.firstDown && (k.type !== "penalty" || parts.length < 3)) {
    parts.push({ text: "1ST DOWN", heavy: false });
  } else if (scene.onDowns) {
    title = titled("Turnover on downs");
  }
  return { parts, title, tone, missed };
}

/** A foul as the referee announces it: the foul, then the side ("Holding, Offense", "Pass Interference, Defense"). */
export function announced(name: string, side: Side | null, offense: Side | null): string {
  for (const [prefix, team] of [
    ["Offensive ", "Offense"],
    ["Defensive ", "Defense"],
  ] as const) {
    if (name.startsWith(prefix)) return `${name.slice(prefix.length)}, ${team}`;
  }
  if (side == null || offense == null) return name;
  return `${name}, ${side === offense ? "Offense" : "Defense"}`;
}

function missWord(miss: FootballScene["miss"]): string {
  switch (miss) {
    case "wideLeft":
      return "Wide left";
    case "wideRight":
      return "Wide right";
    case "short":
      return "Short";
    case "blocked":
      return "Blocked";
    case null:
      return "No good";
  }
}

function kickTitle(scene: FootballScene): string {
  switch (scene.kick) {
    case "touchback":
      return "Touchback";
    case "fairCatch":
      return "Fair catch";
    case "downed":
      return "Downed";
    case "outOfBounds":
      return "Out of bounds";
    case "returned":
    case null: {
      if (scene.scoring === "touchdown") return scene.names.returner != null ? `${scene.names.returner} returns it` : "Returned";
      const back = scene.returnYards ?? scene.yards;
      return scene.names.returner != null ? (back === 0 ? `${scene.names.returner}, no return` : `${scene.names.returner}, ${back} yd return`) : "Returned";
    }
  }
}

/** For tests: the room's top edge (CGRect.maxY), re-exported for framing checks. */
export { maxY };
