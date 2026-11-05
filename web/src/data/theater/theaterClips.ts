/**
 * The game as one broadcast, part 11: clips and the splice
 * (TheaterClips.swift; CHOREOGRAPHY §4.5, §12 Phase 0; BROADCAST §4's
 * "generalized bridge").
 *
 * Phase 0 keeps today's per-play scripts (a replay, a beat, the field between
 * plays) and changes who owns time. Each script is a clip: its figures' paths
 * in the world, its ball, its camera, its decisive moment. The engine places
 * each clip so its decisive moment lands on its play's anchor, and every
 * hand-off from one clip to the next is a splice: from the world exactly as
 * it stands (each man's position, velocity and acceleration, his stride, the
 * ball, the camera with its velocity), each man travels to where the next
 * clip wants him within his limits, the ball goes with whoever has it (or is
 * passed on, inferred), and the camera bends toward the new framing. A replay
 * that follows another play no longer cuts to its own set: the men run there.
 * If the time isn't there, the clip runs a little later (a declared catch-up,
 * quiet up to 1.5 s); nobody outruns his limits and nothing jumps.
 *
 * Pure values, no React: a sport supplies its clips (basketballClips.ts…).
 */
import { easeValue, type Ease, type FieldPoint, type Point } from "../mlb/theaterField";
import { standingCarry } from "./rig";
import { AnchorSolver, type AnchorInput } from "./theaterAnchors";
import type { YawRule } from "./theaterCamera";
import {
  add2,
  length2,
  scale2,
  sub2,
  TheaterCurve,
  TheaterTiming,
  v2,
  ZERO2,
  type ActorID,
  type ActorState,
  type Band,
  type Cue,
  type MotionKey,
  type MotionKeyKind,
  type MotionLimits,
  type PTime,
  type Span,
  type Vec4,
} from "./theaterEngine";
import { MotionPath, TheaterMotion } from "./theaterMotion";
import { Plan, TheaterBake, type PlanChain } from "./theaterPlanChain";

/** A clip figure as the splice matches him to the world's men. */
export interface ClipFigure {
  /** Whose: a team (0 top, 1 bottom) or the officials and staff (2): never matched across. */
  readonly group: number;
  /** What: his role (matched before distance). */
  readonly kind: string;
  /** Who: the data's athlete, when it names him (matched before anything). */
  readonly athlete: string | null;
  /** His motion band (MotionLimits). */
  readonly band: string;
  /** The rig's height (field units). */
  readonly height: number;
}

/** The ball in a clip at an instant (world frame): in a figure's hands, or anywhere else. */
export type ClipBall = { readonly kind: "held"; readonly figure: number } | { readonly kind: "free"; readonly at: FieldPoint; readonly flying: boolean };

/** One of today's scripts as the engine places it. */
export interface TheaterClip {
  /** Its length in its own seconds (it holds its last moment after). */
  readonly length: number;
  /** Its still moment: nothing moves before it, so a splice lands everyone by then. */
  readonly still: number;
  /** Its decisive moment, if it has one (a beat's whistle, a replay's make). */
  readonly decisive: number | null;
  /** Once begun, it plays at least this far before anything may splice out of it (its decisive moment and what must follow it). */
  readonly essential: number;
  /** Ambient (the field between plays): it may be spliced out of anywhere but mid-flight. */
  readonly ambient: boolean;
  readonly figures: readonly ClipFigure[];
  position(figure: number, t: number): Point;
  heading(figure: number, t: number): number;
  opacity(figure: number, t: number): number;
  ball(t: number): ClipBall | null;
  /** The camera it wants: ground center, log span, yaw (world). */
  camera(t: number): Vec4;
  /** Whether anything moves at t (frame tiers). */
  moving(t: number): boolean;
}

/** A figure's velocity in a clip, by central difference (`TheaterClip.velocity`). */
export function clipVelocity(clip: TheaterClip, figure: number, t: number): Point {
  const h = 1 / 240;
  return scale2(sub2(clip.position(figure, t + h), clip.position(figure, t - h)), 1 / (2 * h));
}

export function clipAcceleration(clip: TheaterClip, figure: number, t: number): Point {
  const h = 1 / 120;
  const a = clip.position(figure, t + h);
  const b = clip.position(figure, t);
  const c = clip.position(figure, t - h);
  return v2((a.x - 2 * b.x + c.x) / (h * h), (a.y - 2 * b.y + c.y) / (h * h));
}

/** Whether the ball is in the air at t (no splice out of it then). */
export function clipFlying(clip: TheaterClip, t: number): boolean {
  const b = clip.ball(t);
  return b?.kind === "free" && b.flying;
}

/** A ball passed or tossed between clips (inferred: the inbound, the outlet, the ball to the man who has it next). */
export class BallFlight {
  constructor(
    readonly t0: PTime,
    readonly t1: PTime,
    readonly from: FieldPoint,
    readonly to: FieldPoint,
    /** How far above the straight line it rises at the middle. */
    readonly apex: number,
  ) {}

  point(t: PTime): FieldPoint {
    const u = Math.min(Math.max((t - this.t0) / Math.max(this.t1 - this.t0, 1e-6), 0), 1);
    return {
      x: this.from.x + (this.to.x - this.from.x) * u,
      y: this.from.y + (this.to.y - this.from.y) * u,
      z: this.from.z + (this.to.z - this.from.z) * u + 4 * this.apex * u * (1 - u),
    };
  }
}

/** One clip on p: where its time starts, who plays whom, and how the world got to it. */
export class ClipPlacement<Clip extends TheaterClip> {
  /** Each traveling man's path from the splice to his place in the clip, and when he's on it. */
  travel = new Map<ActorID, MotionPath>();
  join = new Map<ActorID, PTime>();
  /** Men the clip has no part for: they fade where they stand over the travel. */
  leaving: ActorID[] = [];
  /** Men the world didn't have at the splice (a referee for his whistle, a sub coming on): they fade in where the clip has them. */
  entering: ActorID[] = [];
  /** The clip's time when the travel lands (its still moment; later when the play came late and the lead-in was cut short). */
  entry = 0;
  /** The ball, from the splice until the clip has it. */
  ball: BallFlight | null = null;
  /** Who has the ball at the splice and until the flight (or the clip) takes it. */
  holder: ActorID | null = null;
  /** The play it tells (null: the field between plays), its anchor (on p) and how late it was told. */
  play: string | null = null;
  anchor: PTime | null = null;
  slip = 0;
  /** The theater's time less p when it was placed: its decisive moment is at `anchor + shift + slip` on the chain. */
  shift = 0;
  /** Every play its telling covers (its own, a miss's rebound, a replay's retold lead-in). */
  covers: string[] = [];
  /**
   * Where each play it tells is presented on p, at the shift it was placed
   * with (its decisive moment; the plays it covers at theirs). On the chain
   * they're at these plus `shift`: as the shift moves (a hold, a skip), so do they.
   */
  presents = new Map<string, PTime>();

  constructor(
    readonly clip: Clip,
    /** p of the clip's time 0. */
    readonly offset: PTime,
    /** When it takes over: the splice (the travel to it begins here). */
    readonly start: PTime,
    /** Each clip figure's man. */
    readonly cast: readonly ActorID[],
  ) {}

  /** A copy (Swift's value semantics, for a placement carried into a new plan). */
  copy(): ClipPlacement<Clip> {
    const p = new ClipPlacement(this.clip, this.offset, this.start, this.cast);
    p.travel = this.travel;
    p.join = this.join;
    p.leaving = this.leaving;
    p.entering = this.entering;
    p.entry = this.entry;
    p.ball = this.ball;
    p.holder = this.holder;
    p.play = this.play;
    p.anchor = this.anchor;
    p.slip = this.slip;
    p.shift = this.shift;
    p.covers = this.covers;
    p.presents = this.presents;
    return p;
  }

  time(p: PTime): number {
    return p - this.offset;
  }

  /** The figure an actor plays here, or -1. */
  figure(actor: ActorID): number {
    return this.cast.indexOf(actor);
  }

  /** When the clip has everyone (the last join). */
  get joined(): PTime {
    let most = -Infinity;
    for (const j of this.join.values()) most = Math.max(most, j);
    return this.join.size > 0 ? most : this.start;
  }

  /** The earliest a following splice may begin: its essential part done, and never mid-flight. */
  essentialEnd(after: PTime): PTime {
    let at = Math.max(this.offset + this.clip.essential, this.joined, after);
    let guardSteps = 0;
    while (clipFlying(this.clip, at - this.offset) && guardSteps < 600) {
      at += 1 / TheaterTiming.rate;
      guardSteps += 1;
    }
    return at;
  }
}

// MARK: - Who becomes whom

/** A man (or a clip figure) as the match sees him. */
export interface MatchFigure {
  readonly group: number;
  readonly kind: string;
  readonly athlete: string | null;
  readonly at: Point;
}

export const CastMatch = {
  /**
   * Clip figure → world man: the same athlete first, then the nearest of his
   * group and kind, then the nearest of his group; a final pass swaps any two
   * whose swap shortens their moves (TheaterBridge.match, by value).
   */
  match(world: readonly MatchFigure[], clip: readonly MatchFigure[]): Map<number, number> {
    const cost = (r: number, i: number): number => {
      const a = clip[r]!;
      const b = world[i]!;
      if (a.athlete != null && b.athlete != null && a.athlete === b.athlete) return -1;
      let c = length2(sub2(a.at, b.at));
      if (a.kind !== b.kind) c += 1000;
      if (a.athlete != null && b.athlete != null && a.athlete !== b.athlete) c += 500;
      return c;
    };
    const options: { cost: number; r: number; i: number }[] = [];
    for (let r = 0; r < clip.length; r++) {
      for (let i = 0; i < world.length; i++) if (world[i]!.group === clip[r]!.group) options.push({ cost: cost(r, i), r, i });
    }
    options.sort((x, y) => x.cost - y.cost || x.r - y.r || x.i - y.i);
    const pairs = new Map<number, number>();
    const taken = new Set<number>();
    for (const o of options) {
      if (pairs.has(o.r) || taken.has(o.i)) continue;
      pairs.set(o.r, o.i);
      taken.add(o.i);
    }
    let keys = [...pairs.keys()].sort((x, y) => x - y);
    for (let pass = 0; pass < 3; pass++) {
      let swapped = false;
      for (let n = 0; n < keys.length; n++) {
        const a = keys[n]!;
        for (let m = n + 1; m < keys.length; m++) {
          const b = keys[m]!;
          if (clip[a]!.group !== clip[b]!.group) continue;
          const ia = pairs.get(a);
          const ib = pairs.get(b);
          if (ia == null || ib == null) continue;
          if (cost(a, ib) + cost(b, ia) < cost(a, ia) + cost(b, ib) - 0.01) {
            pairs.set(a, ib);
            pairs.set(b, ia);
            swapped = true;
          }
        }
      }
      if (!swapped) break;
      keys = [...pairs.keys()].sort((x, y) => x - y);
    }
    return pairs;
  },
};

// MARK: - The splice

/** The world's men as the splice needs them: their state at an instant, who they are (`Splice.Man`). */
export interface SpliceMan {
  readonly state: ActorState;
  readonly figure: ClipFigure;
}

/**
 * How the world meets a clip (`Splice.Meeting`): who plays whom, when the
 * travel begins, each man's path and when he's on the clip, and how much
 * later than asked the clip has to run.
 */
export interface Meeting {
  readonly cast: ActorID[];
  readonly start: PTime;
  readonly offset: PTime;
  /** The clip's time when the travel lands (its still moment, or later when the play came late). */
  readonly entry: number;
  readonly travel: Map<ActorID, MotionPath>;
  readonly join: Map<ActorID, PTime>;
  readonly leaving: ActorID[];
  readonly slip: number;
  readonly newcomers: ActorID[];
}

/** The next free ActorID (Swift's `inout UInt16`, wrapping). */
export interface ActorIDs {
  next: number;
}

export function takeID(ids: ActorIDs): ActorID {
  const id = ids.next;
  ids.next = (ids.next + 1) & 0xffff;
  return id;
}

export const Splice = {
  /**
   * Meets `clip`, asked to start its time at `offset`, from the world as
   * `world(t)` has it from `earliest` on (the previous clip's essential end).
   * Each matched man travels from his state at the splice to his place in
   * the clip, as slowly as the time allows and no faster than his limits; the
   * splice begins as late as everyone can still make it (the field between
   * plays plays on until then). Normally they join at the clip's still
   * moment. When the play came too late for that (its lead-in is already
   * under way on p), they join the clip later, moving as it moves, at the
   * earliest moment they all can (its lead-in compressed to what's left,
   * §4.6), never inside the play's own action (`latest`) nor with the ball in
   * the air. Only when not even that fits does the clip run later by the
   * difference (the slip). `known`: who plays whom when the sport knows; else matched.
   */
  meet<Clip extends TheaterClip>(
    clip: Clip,
    offset0: PTime,
    earliest: PTime,
    limits: MotionLimits,
    ids: ActorIDs,
    world: (t: PTime) => SpliceMan[],
    known: ReadonlyMap<number, ActorID> | null = null,
    latest: number | null = null,
  ): Meeting {
    // Who plays whom, from the world at the earliest splice.
    const men = world(earliest);
    const cast: (ActorID | null)[] = new Array<ActorID | null>(clip.figures.length).fill(null);
    if (known) {
      for (const [i, id] of known) if (i < cast.length) cast[i] = id;
    } else {
      const at = Math.max(Math.max(offset0 + clip.still, earliest) - offset0, 0);
      const pairs = CastMatch.match(
        men.map((m) => ({ group: m.figure.group, kind: m.figure.kind, athlete: m.figure.athlete, at: m.state.position })),
        clip.figures.map((f, i) => ({ group: f.group, kind: f.kind, athlete: f.athlete, at: clip.position(i, at) })),
      );
      for (const [r, i] of pairs) cast[r] = men[i]!.state.id;
    }
    const newcomers: ActorID[] = [];
    for (let i = 0; i < cast.length; i++) {
      if (cast[i] != null) continue;
      const id = takeID(ids);
      cast[i] = id;
      newcomers.push(id);
    }
    const castIDs = cast as ActorID[];
    const bandOf = (man: SpliceMan, easy: boolean): Band => {
      const b = limits.band(man.figure.band);
      if (easy) {
        b.sprint = b.run;
        b.accel *= 0.6;
        b.decel *= 0.6;
        b.lateral *= 0.6;
      }
      return b;
    };
    /** The acceleration a travel starts with: his own, inside his limits (a clip's harder push isn't carried into the travel; position and speed are). */
    const inherited = (man: SpliceMan, easy: boolean): Point => {
      const b = bandOf(man, easy);
      return TheaterMotion.clamp(man.state.acceleration, Math.min(b.accel, b.decel));
    };
    /** How long the slowest man needs to reach his place at clip time `entry`, moving as the clip moves him there. */
    const needs = (list: readonly SpliceMan[], easy: boolean, entry: number): number => {
      let most = 0;
      castIDs.forEach((id, i) => {
        const man = list.find((m) => m.state.id === id);
        if (!man || !(clip.opacity(i, entry) > 0.01)) return;
        const moving = entry > clip.still + 1e-6;
        const need = TheaterMotion.shortestTravel(
          man.state.position,
          man.state.velocity,
          inherited(man, easy),
          clip.position(i, entry),
          moving ? clipVelocity(clip, i, entry) : ZERO2,
          ZERO2,
          bandOf(man, easy),
          limits.cruiseOver,
        );
        most = Math.max(most, need);
      });
      return most;
    };
    /** The latest splice that still lands everyone by clip time `entry` (from `earliest`, measured again from there). */
    const splice = (easy: boolean, entry: number): { start: PTime; fits: boolean } => {
      let start = Math.max(earliest, offset0 + entry - needs(men, easy, entry));
      for (let k = 0; k < 2 && start > earliest + 1e-6; k++) {
        start = Math.max(earliest, offset0 + entry - needs(world(start), easy, entry));
      }
      return { start, fits: start + needs(world(start), easy, entry) <= offset0 + entry + 1e-6 };
    };
    let entry = clip.still;
    let easy = true;
    let { start, fits } = splice(true, entry);
    if (!fits) {
      easy = false;
      ({ start, fits } = splice(false, entry));
    }
    if (!fits && latest != null && latest > clip.still) {
      // Late: into the clip as it moves, at the first moment everyone can make it.
      let t = clip.still + 0.1;
      while (t <= latest + 1e-9) {
        if (!clipFlying(clip, t)) {
          const s = splice(false, t);
          if (s.fits) {
            entry = t;
            start = s.start;
            fits = true;
            break;
          }
        }
        t += 0.1;
      }
    }
    let offset = offset0;
    let slip = 0;
    const atStart = world(start);
    // A man matched at the earliest splice who's gone by its start (faded out with the clip before) comes back as a
    // newcomer: he enters, rather than reappearing somewhere else.
    const ids2 = [...castIDs];
    for (let i = 0; i < ids2.length; i++) {
      if (atStart.some((m) => m.state.id === ids2[i]) || newcomers.includes(ids2[i]!)) continue;
      ids2[i] = takeID(ids);
      newcomers.push(ids2[i]!);
    }
    const present = new Set(ids2);
    const leaving = atStart.map((m) => m.state.id).filter((id) => !present.has(id));
    const need = needs(atStart, easy, entry);
    if (start + need > offset + entry + 1e-6) {
      slip = start + need - (offset + entry);
      offset += slip;
    }
    const joinAt = offset + entry;
    const travel = new Map<ActorID, MotionPath>();
    const join = new Map<ActorID, PTime>();
    ids2.forEach((id, i) => {
      const man = atStart.find((m) => m.state.id === id);
      if (!man) return;
      const moving = entry > clip.still + 1e-6;
      travel.set(
        id,
        TheaterMotion.travel(
          man.state.position,
          man.state.velocity,
          inherited(man, easy),
          start,
          clip.position(i, entry),
          moving ? clipVelocity(clip, i, entry) : ZERO2,
          moving ? clipAcceleration(clip, i, entry) : ZERO2,
          Math.max(joinAt - start, 1e-3),
          bandOf(man, easy),
          limits.cruiseOver,
        ),
      );
      join.set(id, joinAt);
    });
    return { cast: ids2, start, offset, entry, travel, join, leaving, slip, newcomers };
  },
};

// MARK: - The planner (Phase 0, every sport)

/** One thing to tell (Phase 0): a play, and the plays its telling covers. */
export interface TellUnit<Scene> {
  readonly id: string;
  readonly scene: Scene;
  readonly covers: readonly string[];
  /** A dead-ball play that changes nothing on the field by itself: arriving after its moment, it attaches to the stoppage on screen (§4.6). */
  readonly admin: boolean;
  /** Its clip starts from the world as it stands (a beat); else from its own set (a replay), met by the splice. */
  readonly fromWorld: boolean;
  /** Late, the splice may join its clip as it moves up to this long before the decisive moment (the play's own action). */
  readonly lead: number;
  /** The play whose anchor it lands on, when that isn't its own ID (a baseball beat derived from its entry). */
  readonly anchor: string | null;
}

export function tellUnit<Scene>(id: string, scene: Scene, fields: Partial<Omit<TellUnit<Scene>, "id" | "scene">> = {}): TellUnit<Scene> {
  return { id, scene, covers: [], admin: false, fromWorld: true, lead: 0.9, anchor: null, ...fields };
}

/** A sport's Phase 0 sequencing: today's running order, as clips. */
export interface ClipSequencer<Clip extends TheaterClip, Scene> {
  readonly limits: MotionLimits;
  readonly yawRule: YawRule | null;
  /** The plays as the anchor solver reads them. */
  readonly anchorInputs: readonly AnchorInput[];
  /** The units still to tell after `handled`, in order. */
  units(handled: ReadonlySet<string>): TellUnit<Scene>[];
  /** The field the plays before the page left (the opening: a declared jump). */
  opening(t: PTime): Clip;
  /** What carries on (the placements kept from the plan before): the running order picks up from it. */
  resume(kept: readonly ClipPlacement<Clip>[]): void;
  /** A unit's clip, from the world as `draft` has it at `t`. */
  clip(unit: TellUnit<Scene>, t: PTime, draft: Plan<Clip>): Clip;
  /** The unit was placed (its running order moves on: who has the ball, the field it leaves). */
  told(unit: TellUnit<Scene>): void;
  /** The field between plays after a unit's clip ends at `t`, and its next round after `clip` ends. */
  rest(unit: TellUnit<Scene>, t: PTime, draft: Plan<Clip>): Clip;
  next(clip: Clip, t: PTime, draft: Plan<Clip>): Clip;
  /** The cues a unit's telling fires (the score changing at its decisive moment). */
  cues(unit: TellUnit<Scene>, clip: Clip, decisive: PTime): Cue[];
  /** The ball across the splice into placement `k`. */
  handOff(draft: Plan<Clip>, k: number): void;
}

export const TheaterPlanner = {
  /**
   * The plan from the splice at `c`: what's on screen carries on, each unit
   * still to tell is placed at its anchor (on p, plus the theater's `shift`)
   * and met from the world as it will stand, and the field between plays
   * fills every gap to the horizon. Units at or past `deferFrom` (on p) wait:
   * the clock holds short of them.
   */
  plan<Clip extends TheaterClip, Scene>(
    sequencer: ClipSequencer<Clip, Scene>,
    history: ReadonlySet<string>,
    chain: PlanChain<Clip>,
    c: PTime,
    shift: number,
    deferFrom: PTime | null,
    revision: number,
    ids: ActorIDs,
  ): Plan<Clip> {
    const limits = sequencer.limits;
    const previous = chain.plan(c);
    // What's on screen carries on (and the clip before it, while men still blend out of it).
    let keep: ClipPlacement<Clip>[] = [];
    const toldBefore = new Set(previous?.plan.toldBefore ?? []);
    if (previous) {
      const k = previous.plan.placement(c);
      if (k != null) {
        const from = Math.max(k - 1, 0);
        keep = previous.plan.placements.slice(from, k + 1).map((p) => p.copy());
        for (const p of previous.plan.placements.slice(0, from)) for (const id of p.covers) toldBefore.add(id);
      }
    }
    const draft = new Plan<Clip>(revision, c, c + 60, chain.state(c), keep, new Map(previous?.plan.actors ?? []));
    draft.toldBefore = toldBefore;
    draft.kept = keep.length;
    draft.published = new Map(previous?.plan.published ?? []);
    draft.history = chain.history(c);
    draft.yawRule = sequencer.yawRule;
    if (previous && previous.yawTargets.length > 0) {
      const targets = previous.yawTargets;
      let since = c - 10;
      for (let i = targets.length - 1; i >= 0; i--) {
        if (targets[i]!.at <= c) {
          since = targets[i]!.at;
          break;
        }
      }
      draft.yaw = { target: yawTarget(targets, c), since };
    }
    if (keep.length === 0) {
      // The opening: the field the last play before the page left, everyone in place (a declared jump).
      const clip = sequencer.opening(c);
      const cast: ActorID[] = [];
      for (const figure of clip.figures) {
        const id = takeID(ids);
        cast.push(id);
        draft.actors.set(id, figure);
      }
      draft.placements = [new ClipPlacement(clip, c, c, cast)];
      draft.declared = true;
      draft.openingCamera = clip.camera(0);
      draft.yaw = { target: clip.camera(0).w, since: c - 10 };
    } else {
      sequencer.resume(keep);
    }
    // Everything handled: before the page, told by plans before, or by what carries on.
    const handled = new Set<string>([...history, ...draft.toldBefore]);
    for (const p of draft.placements) for (const id of p.covers) handled.add(id);
    const units = sequencer.units(handled);
    // Anchors: what carries on keeps its own.
    const frozen = new Map<string, PTime>();
    for (const p of draft.placements) if (p.play != null && p.anchor != null) frozen.set(p.play, p.anchor);
    const inputs = sequencer.anchorInputs;
    const anchors = AnchorSolver.solve(inputs, frozen);
    const lastPlaced = draft.placements[draft.placements.length - 1];
    let earliest = lastPlaced ? lastPlaced.essentialEnd(c) : c;
    // Plays past the receding horizon wait for the plan that reaches them (no earlier than this one's horizon).
    const waiting = new Set<string>();
    const men = (t: PTime) => TheaterPlanner.men(draft, t);
    for (let k = 0; k < units.length; k++) {
      const unit = units[k]!;
      const data = anchors.get(unit.anchor ?? unit.id)?.at ?? earliest - shift;
      if (deferFrom != null && data >= deferFrom) break;
      const anchor = data + shift;
      if (Math.max(anchor, earliest) > c + TheaterTiming.planAhead) {
        for (const later of units.slice(k)) {
          waiting.add(later.anchor ?? later.id);
          waiting.add(later.id);
          for (const id of later.covers) waiting.add(id);
        }
        break;
      }
      if (unit.admin && anchor + TheaterTiming.microCatchUp < earliest) {
        draft.toldBefore.add(unit.id);
        for (const id of unit.covers) draft.toldBefore.add(id);
        draft.notes.push({ at: earliest, kind: { kind: "catchUp", play: unit.id, late: earliest - anchor } });
        continue;
      }
      const guess = Math.max(earliest, anchor - 3);
      let clip = sequencer.clip(unit, guess, draft);
      const lead = (cl: Clip) => (cl.decisive != null ? cl.decisive - unit.lead : null);
      let meeting = Splice.meet(clip, anchor - (clip.decisive ?? 0), earliest, limits, ids, men, null, lead(clip));
      if (unit.fromWorld && Math.abs(meeting.start - guess) > 0.3) {
        // It starts from the field as it stands when it begins: built from there.
        clip = sequencer.clip(unit, meeting.start, draft);
        meeting = Splice.meet(clip, anchor - (clip.decisive ?? 0), earliest, limits, ids, men, null, lead(clip));
      }
      // The field between plays the splice cuts before it began never plays.
      const cut = meeting.start;
      draft.placements = draft.placements.filter((p) => !(p.play == null && p.start >= cut - 1e-9 && p.start > c));
      const placement = new ClipPlacement(clip, meeting.offset, meeting.start, meeting.cast);
      placement.travel = meeting.travel;
      placement.join = meeting.join;
      placement.leaving = meeting.leaving;
      placement.play = unit.id;
      placement.anchor = data;
      placement.slip = meeting.slip;
      placement.shift = shift;
      placement.entry = meeting.entry;
      placement.entering = meeting.newcomers;
      placement.covers = [unit.id, ...unit.covers];
      // One truth on p: where each play it tells is presented (its decisive moment; the plays it covers, at theirs).
      placement.presents.set(unit.anchor ?? unit.id, data + meeting.slip);
      for (const id of unit.covers) {
        const a = anchors.get(id)?.at;
        if (a != null) placement.presents.set(id, a + meeting.slip);
      }
      meeting.cast.forEach((id, i) => TheaterPlanner.identify(draft, id, clip.figures[i]!));
      draft.placements.push(placement);
      sequencer.handOff(draft, draft.placements.length - 1);
      const decisive = meeting.offset + (clip.decisive ?? 0);
      if (meeting.slip > 1e-3) draft.notes.push({ at: decisive, kind: { kind: "catchUp", play: unit.id, late: meeting.slip } });
      draft.cues.push(...sequencer.cues(unit, clip, decisive));
      sequencer.told(unit);
      earliest = draft.placements[draft.placements.length - 1]!.essentialEnd(c);
      // The field between plays from where the play leaves everyone.
      const end = meeting.offset + clip.length;
      if (Number.isFinite(end)) TheaterPlanner.append(draft, sequencer.rest(unit, end, draft), end, limits, sequencer, ids);
    }
    // The field between plays round by round to the horizon (then only the men it still has).
    let lastTold = c;
    for (let i = draft.placements.length - 1; i >= 0; i--) {
      const p = draft.placements[i]!;
      if (p.play != null) {
        lastTold = p.offset + Math.min(p.clip.length, 60);
        break;
      }
    }
    draft.horizon = Math.max(c + TheaterTiming.planAhead, lastTold + 5);
    for (;;) {
      const last = draft.placements[draft.placements.length - 1];
      if (!last || !(last.offset + last.clip.length < draft.horizon)) break;
      const end = last.offset + last.clip.length;
      TheaterPlanner.append(draft, sequencer.next(last.clip, end, draft), end, limits, sequencer, ids);
    }
    // One scheduler: every play still to tell gets its moment here, on the theater's time (the director maps it to
    // p through the clock, and the timeline tells each play then, the court, the score and the lists together).
    // What a clip tells is where its decisive frame will be drawn; the rest (an attached substitution, a touch
    // that changed nothing) at the solver's anchor, held between the told plays around it: in order, always.
    const fixed = new Map<string, PTime>();
    for (const p of draft.placements) for (const [id, at] of p.presents) fixed.set(id, at + p.shift);
    // The past is fixed: a moment the court reached before this plan's splice (told then) keeps its time.
    const past = new Set<string>();
    if (previous) {
      for (const [id, at] of previous.plan.decisive) {
        if (at <= c + 1e-6) {
          fixed.set(id, at);
          past.add(id);
        }
      }
    }
    const order = inputs.map((i) => i.id).filter((id) => !history.has(id));
    const ceilings = new Array<number>(order.length).fill(Infinity);
    let ceiling = Infinity;
    for (let i = order.length - 1; i >= 0; i--) {
      ceilings[i] = ceiling;
      const f = fixed.get(order[i]!);
      if (f != null) ceiling = Math.min(ceiling, f);
    }
    let floor = -Infinity;
    const step = 0.01;
    order.forEach((id, i) => {
      let at: PTime;
      // Past the receding horizon: not before the plan that places it (the next, made before this one runs out).
      if (waiting.has(id) && !fixed.has(id)) floor = Math.max(floor, draft.horizon);
      const f = fixed.get(id);
      const solved = anchors.get(id)?.at;
      if (f != null) {
        at = Math.max(f, floor + step);
      } else if (solved != null) {
        // Past the hold, it waits (the clock holds short of it): its moment comes from the plan after.
        if (deferFrom != null && solved >= deferFrom) {
          draft.deferred.add(id);
          return;
        }
        at = Math.min(Math.max(solved + shift, floor + step), ceilings[i]! - step);
        at = Math.max(at, floor + step);
      } else {
        return;
      }
      draft.decisive.set(id, at);
      if (!past.has(id)) draft.published.set(id, at - shift);
      floor = at;
    });
    const present = new Set<ActorID>();
    for (const p of draft.placements) {
      for (const id of p.cast) present.add(id);
      for (const id of p.leaving) present.add(id);
    }
    for (const id of [...draft.actors.keys()]) if (!present.has(id)) draft.actors.delete(id);
    return draft;
  },

  append<Clip extends TheaterClip, Scene>(draft: Plan<Clip>, clip: Clip, t: PTime, limits: MotionLimits, sequencer: ClipSequencer<Clip, Scene>, ids: ActorIDs): void {
    const meeting = Splice.meet(clip, t, t, limits, ids, (at) => TheaterPlanner.men(draft, at));
    const placement = new ClipPlacement(clip, meeting.offset, meeting.start, meeting.cast);
    placement.travel = meeting.travel;
    placement.join = meeting.join;
    placement.leaving = meeting.leaving;
    placement.entry = meeting.entry;
    placement.entering = meeting.newcomers;
    meeting.cast.forEach((id, i) => TheaterPlanner.identify(draft, id, clip.figures[i]!));
    draft.placements.push(placement);
    sequencer.handOff(draft, draft.placements.length - 1);
  },

  /** A man's identity: his team never changes; the athlete a clip credits him as stays with him. */
  identify<Clip extends TheaterClip>(draft: Plan<Clip>, id: ActorID, figure: ClipFigure): void {
    const known = draft.actors.get(id);
    if (known) {
      if (figure.athlete != null) draft.actors.set(id, { ...known, athlete: figure.athlete });
    } else {
      draft.actors.set(id, figure);
    }
  },

  /** The world's men at t as the splice reads them (present ones only). */
  men<Clip extends TheaterClip>(draft: Plan<Clip>, t: PTime): SpliceMan[] {
    const out: SpliceMan[] = [];
    for (const id of draft.everyone) {
      const m = draft.motion(id, t);
      const figure = draft.actors.get(id);
      if (!m || !(m.opacity > 0.05) || !figure) continue;
      out.push({
        state: { id, position: m.position, velocity: m.velocity, acceleration: m.acceleration, rig: standingCarry(m.position, 0), opacity: m.opacity },
        figure,
      });
    }
    return out;
  },
};

/** The target in force at `t` (YawRule.target, here to keep the planner's import of the camera type-only). */
function yawTarget(changes: readonly { at: PTime; yaw: number }[], t: PTime): number {
  let lo = 0;
  let hi = changes.length - 1;
  if (hi < 0) return 0;
  if (t < changes[0]!.at) return changes[0]!.yaw;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (changes[mid]!.at <= t) lo = mid;
    else hi = mid - 1;
  }
  return changes[lo]!.yaw;
}

/**
 * The ball across a splice (every sport): it stays with the man who has it
 * when he's the clip's man with it; else it's passed to him (inferred: the
 * inbound, the outlet, the ball back to the pitcher), landing as he's set.
 */
export const TheaterHandOff = {
  ball<Clip extends TheaterClip>(draft: Plan<Clip>, k: number, speed: number, height: number): void {
    const p = draft.placements[k]!;
    const held = p.clip.ball(p.entry);
    if (held?.kind !== "held" || !(held.figure < p.cast.length)) return;
    const i = held.figure;
    const target = p.cast[i]!;
    const before = TheaterBake.ballSpans(new Plan<Clip>(draft.revision, draft.start, draft.horizon, draft.state, draft.placements.slice(0, k), draft.actors));
    let holder: ActorID | null = null;
    let from: FieldPoint | null = null;
    const span = TheaterBake.ballSpan(before, p.start);
    if (span?.kind === "clip") {
      const q = draft.placements[span.placement]!;
      const b = q.clip.ball(Math.min(Math.max(q.time(p.start), 0), q.clip.length));
      if (b?.kind === "held") holder = q.cast[b.figure] ?? null;
      else if (b?.kind === "free") from = b.at;
    } else if (span?.kind === "held") holder = span.actor;
    else if (span?.kind === "flight") from = span.flight.to;
    if (holder === target) {
      p.holder = target;
      return;
    }
    const join = p.join.get(target) ?? p.offset + p.entry;
    const landing = draft.motion(target, join)?.position ?? p.clip.position(i, p.entry);
    const to: FieldPoint = { x: landing.x, y: landing.y, z: height };
    let start: FieldPoint = from ?? to;
    if (holder != null) {
      const m = draft.motion(holder, p.start);
      if (m) start = { x: m.position.x, y: m.position.y, z: height };
    }
    const distance = Math.hypot(to.x - start.x, to.y - start.y);
    const duration = Math.min(Math.max(distance / speed, 0.35), 1.2);
    const launch = Math.max(p.start, join - duration);
    let origin = start;
    if (holder != null) {
      const m = draft.motion(holder, launch);
      if (m) origin = { x: m.position.x, y: m.position.y, z: height };
    }
    p.holder = holder;
    p.ball = new BallFlight(launch, launch + duration, origin, to, 1 + distance / 30);
  },
};

// MARK: - Today's paths, re-made (Phase 0)

/** A script's move as the re-synthesis reads it (PlayScript.Move): its times, its path, its easing. */
export interface ClipMove {
  readonly start: number;
  readonly end: number;
  readonly path: readonly Point[];
  readonly ease: Ease;
  readonly lengths: readonly number[];
  readonly length: number;
  point(t: number): Point;
}

/**
 * Each figure's path in today's scripts re-made through the motion layer
 * (CHOREOGRAPHY §5.5.3): today's moves are polylines, each its own easing, so
 * a man stops dead between two moves, turns a corner in a frame, or starts at
 * full speed. The same vertices at the same moments become keys (each ball
 * contact a hard key, so every catch, pass and shot meets the ball exactly
 * where it did), and quintics through them carry him C²: he runs through a
 * junction, rounds the corner, eases into a start. Null: he never moves.
 *
 * The script's clock is the clock: a clip runs at its script's own pace, its
 * flights to the frame. A man the script asks too much of is solved on his
 * own, and nobody else slows for him (`solved`).
 */
export const ClipPaths = {
  /**
   * `solve`: false to take the keys exactly as they are. `seams`: moments he
   * must keep (a loop's ends: what he does either side has to meet).
   */
  resynthesized(
    input: readonly ClipMove[],
    contacts: readonly number[],
    band: Band,
    span: Span,
    position: (t: number) => Point,
    solve = true,
    seams: readonly number[] = [],
  ): MotionPath | null {
    // (A stable sort, as Swift's `sorted` is on these.)
    const moves = [...input].sort((a, b) => a.start - b.start);
    if (moves.length === 0) return null;
    const keys: MotionKey[] = [];
    const add = (t: number, p: Point, kind: MotionKeyKind, hard: boolean) => {
      const at = v2(p.x, p.y);
      const last = keys[keys.length - 1];
      if (last && t - last.t < 0.06) {
        // Too close to the last key: the harder of the two stands.
        if (hard || !last.hard) keys[keys.length - 1] = { t: Math.max(t, last.t), at, kind, hard: hard || last.hard };
        return;
      }
      keys.push({ t, at, kind, hard });
    };
    moves.forEach((m, n) => {
      const next = n + 1 < moves.length ? moves[n + 1]! : null;
      const cut = next != null && next.start < m.end - 1e-6;
      const end = cut ? next!.start : m.end;
      // Leaving from rest (nothing before it, or the move before ended a while ago).
      const resting = n === 0 || moves[n - 1]!.end < m.start - 0.08;
      add(m.start, m.point(m.start), resting ? "depart" : "through", false);
      // Each corner, at the moment today's easing reaches it along the path.
      let along = 0;
      for (let k = 0; k < Math.max(m.lengths.length - 1, 0); k++) {
        along += m.lengths[k]!;
        const t = m.start + ClipPaths.inverse(m.ease, along / Math.max(m.length, 1e-9)) * (m.end - m.start);
        if (!(t < end - 0.04 && t > m.start + 0.04)) continue;
        add(t, m.path[k + 1]!, "through", false);
      }
      const arriving = !cut && (next ? next.start > m.end + 0.08 : true);
      add(end, m.point(end), arriving ? "arrive" : "through", false);
    });
    // Where the ball meets him, exactly where it did; and the moments he has to keep.
    for (const t of [...contacts, ...seams]) {
      const first = keys[0];
      const last = keys[keys.length - 1];
      if (!first || !last || !(t > first.t && t < last.t)) continue;
      const at = position(t);
      for (let i = keys.length - 1; i >= 0; i--) if (Math.abs(keys[i]!.t - t) < 0.06 && !keys[i]!.hard) keys.splice(i, 1);
      let index = keys.findIndex((k) => k.t > t);
      if (index < 0) index = keys.length;
      keys.splice(index, 0, { t, at: v2(at.x, at.y), kind: "through", hard: true });
    }
    // A contact past either end of his moves is where he starts or finishes: that spot stands too.
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (first && contacts.some((c) => c <= first.t)) keys[0] = { ...first, hard: true };
    if (last && contacts.some((c) => c >= last.t)) keys[keys.length - 1] = { ...last, hard: true };
    if (keys.length <= 1) return null;
    return TheaterMotion.path(solve ? ClipPaths.solved(keys, band, span) : keys, band);
  },

  /**
   * The least time a run of `length` takes him, as he stands at either end:
   * from rest to rest whichever of one easing and a ramp, a cruise and a ramp
   * is quicker; from or to a run, half of that; between two runs, his sprint.
   */
  least(length: number, restA: boolean, restB: boolean, band: Band): number {
    if (restA && restB) return Math.min(TheaterMotion.shortest(length, band), ClipPaths.cruising(length, band).time);
    if (restA || restB) return Math.max((1.5 * length) / band.sprint, Math.sqrt((3.5 * length) / Math.min(band.accel, band.decel)));
    return length / band.sprint;
  },

  /** Rest to rest by a ramp (at the band's push), a cruise and a ramp: the least time and the cruise's speed. */
  cruising(length: number, band: Band): { time: number; speed: number } {
    // A quintic ramp to speed v takes 1.875 v / push and covers half of v times that.
    const c = 0.9375 * (1 / band.accel + 1 / band.decel);
    const best = Math.sqrt(length / c);
    const v = Math.min(best, band.sprint);
    return { time: length / v + c * v, speed: v };
  },

  /** How far along his path he can get in `time`, as he stands at either end (`least`, turned round). */
  reach(time: number, restA: boolean, restB: boolean, band: Band): number {
    let lo = 0;
    let hi = band.sprint * Math.max(time, 0);
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (ClipPaths.least(mid, restA, restB, band) <= time) lo = mid;
      else hi = mid;
    }
    return lo;
  },

  /**
   * Today's key times kept where a man can make them. Where he can't (a move
   * faster than his sprint, a start or stop harder than his legs), him
   * alone, in this order:
   * - he leaves earlier (from where he stood) or arrives later (where he
   *   stops), never past a ball contact nor the clip's ends;
   * - he runs it as a run, up to speed and holding it, not one long easing;
   * - he ends short of a spot he's not credited with reaching, how far he got
   *   is where what he does next starts; his last run of the clip he's still
   *   on, so the next clip carries him on from there;
   * - a man who must meet the ball starts as near it as he has to.
   * Two contacts too close for his legs are the only thing left as it is: the ball wins.
   */
  solved(input: readonly MotionKey[], band: Band, span: Span): MotionKey[] {
    if (input.length <= 1) return input.map((k) => ({ ...k }));
    const keys = input.map((k) => ({ ...k }));
    const bound = (k: MotionKey) => k.hard || k.kind === "depart" || k.kind === "arrive";
    const rest = (k: MotionKey, first: boolean) => k.kind === "depart" || k.kind === "arrive" || (first && !k.hard);
    let a = 0;
    let passes = 0;
    while (a < keys.length - 1 && passes < 4 * input.length) {
      passes += 1;
      let b = a + 1;
      while (b < keys.length - 1 && !bound(keys[b]!)) b += 1;
      const along = [0];
      let fastest = 0;
      for (let k = a; k < b; k++) {
        const d = length2(sub2(keys[k + 1]!.at, keys[k]!.at));
        along.push(along[along.length - 1]! + d);
        fastest = Math.max(fastest, d / Math.max(keys[k + 1]!.t - keys[k]!.t, 1e-6));
      }
      const length = along[along.length - 1]!;
      const restA = rest(keys[a]!, a === 0);
      const restB = rest(keys[b]!, false);
      const need = ClipPaths.least(length, restA, restB, band);
      let t0 = keys[a]!.t;
      let t1 = keys[b]!.t;
      // Today's own timing when he can make it (one easing or a walk: nothing to see).
      const plain =
        !restA ||
        !restB ||
        ((1.875 * length) / Math.max(t1 - t0, 1e-6) <= band.sprint && (5.77 * length) / Math.max(t1 - t0, 1e-6) ** 2 <= Math.min(band.accel, band.decel));
      if (!(length > 0.05) || (t1 - t0 >= need && fastest <= band.sprint && plain)) {
        a = b;
        continue;
      }
      if (t1 - t0 < need) {
        let short = need - (t1 - t0);
        // Later into a stop that isn't pinned (up to the next key, or the clip's end).
        if (keys[b]!.kind === "arrive" && !keys[b]!.hard) {
          const limit = b + 1 < keys.length ? keys[b + 1]!.t - 0.06 : span.upper;
          const more = Math.min(short, Math.max(limit - t1, 0));
          t1 += more;
          short -= more;
        }
        // Earlier out of a standing start that isn't pinned (down to the key before, or the clip's start).
        if (short > 1e-6 && keys[a]!.kind === "depart" && !keys[a]!.hard) {
          const limit = a > 0 ? keys[a - 1]!.t + 0.06 : span.lower;
          t0 -= Math.min(short, Math.max(t0 - limit, 0));
        }
      }
      const time = t1 - t0;
      if (time >= need - 1e-6) {
        ClipPaths.shape(keys, a, b, t0, t1, along, restA, restB, band);
        // The shape may have added keys: on from the run's end.
        const next = keys.findIndex((k) => k.t >= t1 - 1e-9);
        a = next >= 0 ? next : keys.length - 1;
        continue;
      }
      const got = ClipPaths.reach(time, restA, restB, band);
      if (!keys[b]!.hard) {
        // He ends short, or (the clip's last run) is still on his way when it ends.
        const last = b === keys.length - 1;
        const open = last && restB;
        const distance = open ? Math.min(length, ClipPaths.reach(time, restA, false, band)) : got;
        const was = keys[b]!.at;
        const here = pointAlong(along, keys, a, distance);
        const direction = headingAlong(along, keys, a, distance);
        const inside: MotionKey[] = [];
        for (let k = a + 1; k < b; k++) {
          if (!(along[k - a]! < distance - 0.5)) continue;
          inside.push({ ...keys[k]!, t: t0 + (along[k - a]! / Math.max(distance, 1e-6)) * time });
        }
        keys[a]!.t = t0;
        keys[b]!.t = t1;
        keys[b]!.at = here;
        if (open) {
          // At a run's pace, or what the time lets him get to: the next clip takes that over.
          const speed = Math.min(band.run, restA ? (2 * distance) / Math.max(time, 1e-6) : band.sprint);
          keys[b]!.kind = "through";
          keys[b]!.velocity = scale2(direction, speed);
          keys[b]!.acceleration = ZERO2;
        }
        // What he does next starts from where he got to.
        let k = b + 1;
        while (k < keys.length && length2(sub2(keys[k]!.at, was)) < 0.5) {
          if (!keys[k]!.hard) keys[k]!.at = here;
          k += 1;
        }
        keys.splice(a + 1, b - (a + 1), ...inside);
        a += inside.length + 1;
        continue;
      }
      if (!keys[a]!.hard && (a === 0 || keys[a]!.kind === "depart" || keys[a]!.kind === "arrive")) {
        // He has to meet the ball: he starts as near it as his legs need.
        const from = pointAlong(along, keys, a, length - got);
        const inside: MotionKey[] = [];
        for (let k = a + 1; k < b; k++) {
          if (!(along[k - a]! > length - got + 0.5)) continue;
          inside.push({ ...keys[k]!, t: t0 + ((along[k - a]! - (length - got)) / Math.max(got, 1e-6)) * time });
        }
        const was = keys[a]!.at;
        keys[a]!.t = t0;
        keys[a]!.at = from;
        keys.splice(a + 1, b - (a + 1), ...inside);
        // Where he stood before it moved with it: the run before ends here now.
        if (a > 0) {
          let k = a - 1;
          while (k >= 0 && length2(sub2(keys[k]!.at, was)) < 0.5 && !keys[k]!.hard) {
            keys[k]!.at = from;
            k -= 1;
          }
          if (k >= 0) {
            // Solved again, from the run that now ends somewhere else.
            let back = a - 1;
            while (back > 0 && !bound(keys[back]!)) back -= 1;
            a = Math.max(back - 1, 0);
            while (a > 0 && !bound(keys[a]!)) a -= 1;
            continue;
          }
        }
        a += inside.length + 1;
        continue;
      }
      // Contact to contact: the ball's moments stand.
      a = b;
    }
    return keys;
  },

  /**
   * The run's keys re-timed to `t0...t1`, on the run's own shape: by
   * distance, eased out of a stand and into a stop; when one easing would ask
   * more than he has, up to speed, holding it, and down.
   */
  shape(keys: MotionKey[], a: number, b: number, t0: number, t1: number, along: readonly number[], restA: boolean, restB: boolean, band: Band): void {
    const length = along[along.length - 1]!;
    const time = t1 - t0;
    keys[a]!.t = t0;
    keys[b]!.t = t1;
    const oneEasing = (1.875 * length) / time <= band.sprint && (5.77 * length) / (time * time) <= Math.min(band.accel, band.decel);
    const c = 0.9375 * (1 / band.accel + 1 / band.decel);
    // A run needs room for its two ramps: short of that, one easing is the quicker of the two.
    if (restA && restB && !oneEasing && time * time >= 4 * c * length) {
      // A ramp, a cruise and a ramp: the cruise as slow as the time allows.
      const root = Math.sqrt(time * time - 4 * c * length);
      const v = (time - root) / (2 * c);
      const r1 = (1.875 * v) / band.accel;
      const r3 = (1.875 * v) / band.decel;
      const d1 = (v * r1) / 2;
      const d3 = (v * r3) / 2;
      const run: MotionKey[] = [];
      const up: MotionKey = {
        t: t0 + r1,
        at: pointAlong(along, keys, a, d1),
        kind: "through",
        velocity: scale2(headingAlong(along, keys, a, d1), v),
        acceleration: ZERO2,
        hard: false,
      };
      const down: MotionKey = {
        t: t1 - r3,
        at: pointAlong(along, keys, a, length - d3),
        kind: "through",
        velocity: scale2(headingAlong(along, keys, a, length - d3), v),
        acceleration: ZERO2,
        hard: false,
      };
      if (r1 > 0.04 && d1 > 0.5 && d1 < length - d3 - 0.5) run.push(up);
      for (let k = a + 1; k < b; k++) {
        const s = along[k - a]!;
        if (!(s > d1 + 0.5 && s < length - d3 - 0.5)) continue;
        run.push({ ...keys[k]!, t: t0 + r1 + (s - d1) / Math.max(v, 1e-6) });
      }
      if (r3 > 0.04 && d3 > 0.5 && d1 < length - d3 - 0.5) run.push(down);
      keys.splice(a + 1, b - (a + 1), ...run);
      return;
    }
    const share = (s: number): number => {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const u = (lo + hi) / 2;
        let covered: number;
        if (restA && restB) covered = u * u * u * (10 - 15 * u + 6 * u * u);
        else if (restA) covered = u * u * (2 - u);
        else if (restB) {
          const w = 1 - u;
          covered = 1 - w * w * (2 - w);
        } else covered = u;
        if (covered < s) lo = u;
        else hi = u;
      }
      return (lo + hi) / 2;
    };
    for (let k = a + 1; k < b; k++) keys[k]!.t = t0 + share(along[k - a]! / Math.max(length, 1e-9)) * time;
  },

  /** The moment an easing reaches `share` of its way (bisection: every easing here is monotone). */
  inverse(ease: Ease, share: number): number {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (easeValue(ease, mid) < share) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  },
};

/** The point `distance` along the run from key `a`. */
function pointAlong(along: readonly number[], keys: readonly MotionKey[], a: number, distance: number): Point {
  let i = 0;
  while (i + 2 < along.length && along[i + 1]! < distance) i += 1;
  const span = Math.max(along[i + 1]! - along[i]!, 1e-9);
  const u = Math.min(Math.max((distance - along[i]!) / span, 0), 1);
  return add2(keys[a + i]!.at, scale2(sub2(keys[a + i + 1]!.at, keys[a + i]!.at), u));
}

/** Which way the run goes `distance` along it. */
function headingAlong(along: readonly number[], keys: readonly MotionKey[], a: number, distance: number): Point {
  let i = 0;
  while (i + 2 < along.length && along[i + 1]! < distance) i += 1;
  const d = sub2(keys[a + i + 1]!.at, keys[a + i]!.at);
  const m = length2(d);
  return m > 1e-9 ? scale2(d, 1 / m) : ZERO2;
}

/**
 * The last resort (§5.5.4, §6): a man `ClipPaths.solved` can't make feasible
 * (two contacts too close for his legs) fades out before the stretch he can't
 * make and back in after it, rather than gliding at a speed no one runs.
 * Declared: the bench counts them.
 */
export class ClipFades {
  static readonly none = new ClipFades([]);
  /** The fade either side of a hidden stretch. */
  static readonly fade = 0.25;

  constructor(
    /** Per figure, the clip-time spans he's hidden through (each with its fade either side). */
    readonly spans: readonly (readonly Span[])[],
  ) {}

  get count(): number {
    return this.spans.reduce((n, s) => n + s.length, 0);
  }

  /** `speed(i, t)`: figure i's speed at the clip's time t. */
  static make(figures: number, length: number, bands: readonly Band[], speed: (i: number, t: number) => number): ClipFades {
    if (!Number.isFinite(length) || !(length > 0)) return ClipFades.none;
    const fade = ClipFades.fade;
    const spans: Span[][] = [];
    for (let i = 0; i < figures; i++) {
      const mine: Span[] = [];
      const limit = bands[i]!.sprint * 1.05;
      let t = 0;
      let from: number | null = null;
      while (t <= length) {
        const fast = speed(i, t) > limit;
        if (fast && from == null) from = t;
        if (!fast && from != null) {
          mine.push({ lower: from - fade, upper: t + fade });
          from = null;
        }
        t += 1 / 60;
      }
      if (from != null) mine.push({ lower: from - fade, upper: length + fade });
      // Overlapping fades merge.
      const merged: Span[] = [];
      for (const s of mine) {
        const last = merged[merged.length - 1];
        if (last && s.lower <= last.upper + fade) merged[merged.length - 1] = { lower: last.lower, upper: Math.max(last.upper, s.upper) };
        else merged.push(s);
      }
      spans.push(merged);
    }
    return new ClipFades(spans);
  }

  /** How much of figure i shows at t: 1 outside his hidden stretches, out and in over `fade` at their ends. */
  opacity(i: number, t: number): number {
    const mine = this.spans[i];
    if (!mine) return 1;
    let o = 1;
    for (const s of mine) {
      if (!(t > s.lower && t < s.upper)) continue;
      // In from either end over the fade, then gone between.
      const depth = Math.min(Math.min(t - s.lower, s.upper - t) / ClipFades.fade, 1);
      o = Math.min(o, 1 - TheaterCurve.inOut(depth));
    }
    return o;
  }
}
