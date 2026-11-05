/**
 * The basketball theater on the choreography engine, Phase 0
 * (BasketballClips.swift; CHOREOGRAPHY §12): today's scripts (a marquee
 * replay, a beat, the court between plays) become clips the engine places at
 * their plays' anchors, and every hand-off between them is a splice from the
 * world as it stands.
 *
 * The world frame is the absolute court (§7.1): x 0–94 along it, y 0–50 from
 * the near sideline, the right basket at x = 88.75. A script is laid out in
 * its own frame, the offense attacking the basket at x = 88.75, and drawn
 * turned half a turn when its play is at the left basket; in the world that
 * half turn is the figures' (x → 94 − x, y → 50 − y), and the view's yaw is
 * −30° at the right basket and +30° at the left: a camera parameter that
 * orbits as the ball changes ends, never a frame that snaps (B4).
 *
 * The painter (`HoopsPainter`) is the drawing's: features/game/nba/theater/directedCourt.ts.
 */
import type { JSONValue } from "../json";
import type { Teams } from "../liveFeeds/basketball";
import type { Side } from "../models";
import type { CameraFrame } from "../mlb/playCamera";
import type { FieldPoint, Point } from "../mlb/theaterField";
import { endsRight, hoopsEnds, isInbound, restOf, restScript, beatScript, type HoopsEnds, type Lineup, type RestSpec, type Formation } from "./basketballBeats";
import { isMarquee, restAfter, type BasketballUnit } from "./basketballFlow";
import { ADMIN, afterSide, made, parseScene, replays, typeOf, type BasketballScene } from "./basketballScene";
import { BasketballScript, Hoops, view, type Player } from "./basketballScript";
import { AnchorSolver, anchorInput, type AnchorInput } from "./theaterAnchors";
import { YawRule } from "./theaterCamera";
import { ClipPaths, TheaterHandOff, TheaterPlanner, tellUnit, type ActorIDs, type ClipBall, type ClipFigure, type ClipPlacement, type ClipSequencer, type TellUnit, type TheaterClip } from "./theaterClips";
import { sameFields, type TheaterSport } from "./theaterDirector";
import { MotionLimits, remainder, v2, vec4, type Cue, type PTime, type Vec4 } from "./theaterEngine";
import type { MotionPath } from "./theaterMotion";
import { TheaterBake, type Plan, type PlanChain } from "./theaterPlanChain";
import type { RawPlay, TimelinePlay } from "./theaterSource";

export const HoopsWorld = {
  /** The court's center: a left-basket script turns about it. */
  center: v2(Hoops.length / 2, Hoops.width / 2),

  /** The world yaw at each basket. */
  yaw(right: boolean): number {
    return right ? -Hoops.turn : Hoops.turn;
  },

  /** Whether a script is laid out at the right basket (its yaw is the right's). */
  right(yaw: number): boolean {
    return Math.abs(remainder(yaw - Hoops.yawRight(true), 2 * Math.PI)) < 0.1;
  },

  /** A point of a script's frame in the world. */
  point(p: Point, right: boolean): Point {
    return right ? v2(p.x, p.y) : v2(Hoops.length - p.x, Hoops.width - p.y);
  },

  /** A world point in a script's frame. */
  local(p: Point, right: boolean): Point {
    return right ? v2(p.x, p.y) : v2(Hoops.length - p.x, Hoops.width - p.y);
  },

  point3(p: FieldPoint, right: boolean): FieldPoint {
    const g = HoopsWorld.point(p, right);
    return { x: g.x, y: g.y, z: p.z };
  },

  /** A heading of a script's frame in the world. */
  heading(h: number, right: boolean): number {
    return right ? h : h + Math.PI;
  },

  /** A script's camera framing (in its view, at its yaw) as the world camera: the ground point at the view's center, the span, the world yaw. */
  camera(frame: CameraFrame, yaw: number): Vec4 {
    const right = HoopsWorld.right(yaw);
    // The view's (x, y) back onto the ground: y was halved by the dimetric view.
    const vx = frame.x;
    const vy = 2 * frame.y;
    const gx = vx * Math.cos(yaw) - vy * Math.sin(yaw);
    const gy = vx * Math.sin(yaw) + vy * Math.cos(yaw);
    const world = right ? v2(gx, gy) : v2(Hoops.length - gx, Hoops.width - gy);
    return vec4(world.x, world.y, Math.log(frame.span), HoopsWorld.yaw(right));
  },

  /** The world camera as a framing in a script's frame (right or left basket), and that frame's yaw. */
  frame(camera: Vec4, right: boolean): { frame: CameraFrame; yaw: number } {
    const yaw = right ? camera.w : camera.w + Math.PI;
    const center = HoopsWorld.local(v2(camera.x, camera.y), right);
    const v = view(center, yaw);
    return { frame: { x: v.x, y: v.y / 2, span: Math.exp(camera.z) }, yaw };
  },
};

/** The camera follows the ball's end of the floor (§5.6.3): `YawRule.basketball`. */
export const basketballYaw = new YawRule(Hoops.length / 2, 6, 2, HoopsWorld.yaw(true), HoopsWorld.yaw(false));

// MARK: - Clips

export type HoopsClipKind = "replay" | "beat" | "rest";

const CONTACTS = new Set(["catchBall", "pass", "lob", "shoot", "layup", "dunk", "hook", "tip", "rebound", "steal", "block"]);

/** One of today's basketball scripts as the engine places it: a marquee replay, a lighter beat, or the court between plays. */
export class HoopsClip implements TheaterClip {
  /** Laid out at the right basket (else turned half a turn into the world). */
  readonly right: boolean;
  readonly figures: readonly ClipFigure[];
  readonly length: number;
  readonly still: number;
  readonly decisive: number | null;
  readonly essential: number;
  /** Each figure's path re-made through the motion layer (ClipPaths). */
  readonly paths: readonly (MotionPath | null)[];

  constructor(
    readonly script: BasketballScript,
    readonly scene: BasketballScene | null,
    readonly kind: HoopsClipKind,
    /** The rest it was built from (the court between plays), for the next one's flow. */
    readonly rest: RestSpec | null = null,
  ) {
    this.right = HoopsWorld.right(script.yaw);
    const offense = script.side ?? "top";
    this.figures = script.players.map((p, i) => {
      const group = p.team === "offense" ? (offense === "top" ? 0 : 1) : p.team === "defense" ? (offense === "top" ? 1 : 0) : 2;
      const off = p.team === "official" || p.team === "staff";
      const credit = script.credits.get(i);
      return {
        group,
        kind: p.team === "staff" ? "staff" : off ? "official" : "player",
        athlete: credit ? (credit.id ?? credit.name) : null,
        band: off ? "official" : "wing",
        height: Hoops.ground,
      };
    });
    const bands = script.players.map((p) => MotionLimits.basketball.band(p.team === "official" || p.team === "staff" ? "official" : "wing"));
    this.paths = script.players.map((p, i) => HoopsClip.resynthesized(p, bands[i]!, script.duration));
    this.length = script.duration;
    this.still = kind === "replay" ? script.leadIn : 0;
    this.decisive = HoopsClip.decisiveOf(script, scene, kind);
    this.essential = kind === "rest" ? 0 : Math.min(this.length, (this.decisive ?? 0) + (kind === "replay" ? 1.6 : 0.8));
  }

  /** The script's time at the clip's time `t`. */
  local(t: number): number {
    return t;
  }

  static resynthesized(player: Player, band: ReturnType<typeof MotionLimits.basketball.band>, duration: number): MotionPath | null {
    const contacts = player.actions.filter((a) => CONTACTS.has(a.kind)).map((a) => a.at);
    return ClipPaths.resynthesized(player.moves, contacts, band, { lower: 0, upper: duration }, (t) => player.position(t));
  }

  /** The instant a clip's play is about (CHOREOGRAPHY §5.1's decisive moment, as today's scripts stage it). */
  static decisiveOf(s: BasketballScript, scene: BasketballScene | null, kind: HoopsClipKind): number | null {
    if (kind === "rest" || !scene) return null;
    const flash = (beat: string) => s.flashes.find((f) => f.beat === beat)?.at ?? null;
    const action = (kind: string) => {
      for (const p of s.players) for (const a of p.actions) if (a.kind === kind) return a.at;
      return null;
    };
    switch (scene.kind) {
      case "jumper":
      case "three":
      case "layup":
      case "dunk":
      case "alleyOop":
      case "putback":
      case "freeThrow":
        return s.score ?? s.rimHit ?? flash("rim") ?? s.release;
      case "block":
        return flash("block") ?? s.release;
      case "offensiveRebound":
      case "defensiveRebound":
        return flash("catchBall") ?? action("rebound") ?? 0.5;
      case "steal":
      case "turnover":
        return flash("steal") ?? flash("whistle") ?? s.tag?.at ?? 0.5;
      case "foul":
      case "violation":
        return flash("whistle") ?? s.tag?.at ?? 0.5;
      case "jumpBall":
        return action("toss") ?? flash("catchBall") ?? 0.5;
      case "substitution":
      case "timeout":
      case "periodEnd":
      case "challenge":
        return flash("horn") ?? s.tag?.at ?? 0.3;
    }
  }

  get ambient(): boolean {
    return this.kind === "rest";
  }

  position(figure: number, t: number): Point {
    const u = this.local(t);
    const path = this.paths[figure];
    if (path) return HoopsWorld.point(path.position(u), this.right);
    return HoopsWorld.point(this.script.players[figure]!.position(u), this.right);
  }

  heading(figure: number, t: number): number {
    const track = this.script.rig[figure];
    const h = track ? track.motion(this.local(t)).heading : 0;
    return HoopsWorld.heading(h, this.right);
  }

  opacity(figure: number, t: number): number {
    return this.script.players[figure]!.opacity(this.local(t));
  }

  ball(t: number): ClipBall | null {
    const u = this.local(t);
    const carrier = this.script.carrier(u);
    if (carrier) return { kind: "held", figure: carrier.player };
    const b = this.script.ball(u);
    if (!b) return null;
    return { kind: "free", at: HoopsWorld.point3(b, this.right), flying: this.script.flight(u) != null };
  }

  camera(t: number): Vec4 {
    return HoopsWorld.camera(this.script.camera.frame(this.local(t)), this.script.yaw);
  }

  moving(t: number): boolean {
    const u = this.local(t);
    if (!(t >= 0) || !(u <= this.script.duration)) return false;
    return this.kind === "rest" ? this.script.active.some(([a, b]) => u >= a && u <= b) : true;
  }

  /** The floor's shape at t (play, the lane, the benches…): a beat that follows starts from it only in play. */
  get formation(): Formation {
    return this.script.formation;
  }
}

// MARK: - The running order (Phase 0)

/**
 * Every play still to tell after `told`, as the units today's queue would
 * make (substitutions at one stoppage together, a miss with its rebound, a
 * replay with the lead-in it retells), none passed over: on p there's time
 * for all of them (`BasketballQueue.units`). (pure)
 */
export function basketballUnits(plays: readonly BasketballScene[], told: ReadonlySet<string>): BasketballUnit[] {
  const pending = plays.filter((p) => !told.has(p.id));
  const ids = new Set(pending.map((p) => p.id));
  const retold = new Set(pending.filter(replays).flatMap((p) => p.leadIn));
  const units: BasketballUnit[] = [];
  const covered = new Set<string>();
  let i = 0;
  while (i < pending.length) {
    const play = pending[i]!;
    i += 1;
    if (covered.has(play.id) || retold.has(play.id)) continue;
    const group: BasketballScene[] = [];
    if (play.kind === "substitution") {
      group.push(play);
      while (i < pending.length && pending[i]!.kind === "substitution") {
        group.push(pending[i]!);
        i += 1;
      }
    }
    const later = play.follows.filter((id) => ids.has(id));
    const covers = [...later, ...(replays(play) ? play.leadIn.filter((id) => ids.has(id)) : []), ...group.slice(1).map((s) => s.id)];
    for (const id of later) covered.add(id);
    units.push({ scene: play, group, covers, skipped: 0 });
  }
  return units;
}

// MARK: - Anchors (§5.1, §7.1)

const SHOTS = new Set(["jumper", "three", "layup", "dunk", "alleyOop", "putback", "block"]);

export const HoopsAnchors = {
  /**
   * How long before a play's decisive moment the theater needs its details
   * (the binding horizon, by the timeline's kind label): a shot's catch or
   * gather ~2.5 s before its release, the free throw's routine 4 s; dead-ball
   * admin never (it attaches to the stoppage on screen).
   */
  horizons: {
    shot: 3.5,
    rebound: 2.5,
    turnover: 3.0,
    "jump ball": 3.0,
    "free throw": 4.0,
    foul: 0,
    timeout: 0,
    substitution: 0,
    review: 0,
    "team rebound": 0,
    "period end": 0,
    "game end": 0,
  } as Readonly<Record<string, number>>,

  /** A shot's flight, rim to release (s): a three about 1.2 s. */
  flight(distance: number): number {
    return 0.55 + 0.027 * distance;
  },

  /** The plays as the anchor solver reads them: each one's believed time and the physics gap to the next. */
  inputs(plays: readonly TimelinePlay<BasketballScene>[]): AnchorInput[] {
    return plays.map((p, i) => {
      const s = p.play;
      const next = plays[i + 1];
      let weight: number;
      switch (p.kind.label) {
        case "shot":
        case "rebound":
        case "turnover":
        case "jump ball":
        case "free throw":
          weight = 1;
          break;
        case "foul":
          weight = 0.75;
          break;
        case "team rebound":
        case "period end":
        case "game end":
          weight = 0.5;
          break;
        default:
          weight = 0;
      }
      if (p.estimated) weight *= 0.25;
      // The rebound that restarts a stopped clock happens at the restart itself.
      const restarts = p.kind.phase === "live";
      return anchorInput({
        id: p.id,
        period: p.period,
        eventTime: p.eventTime,
        bounds: p.eventBounds,
        elapsed: p.clock.elapsed,
        resolution: p.clock.resolution,
        live: p.kind.phase === "live",
        stopsClock: p.kind.stopsClock,
        weight,
        gapAfter: next ? HoopsAnchors.gap(s, next.play) : AnchorSolver.least,
        restartAfter: restarts ? 0 : 1,
      });
    });
  },

  /** The least time between two consecutive decisive moments (§5.1 step 3; tune). */
  gap(a: BasketballScene, b: BasketballScene): number {
    if ((SHOTS.has(a.kind) || a.kind === "freeThrow") && !made(a) && (b.kind === "offensiveRebound" || b.kind === "defensiveRebound")) {
      // Off the rim and into two hands: longer off a long miss (§5.1's flight measured from the rim).
      return Math.max(0.8, 0.45 + 0.022 * (a.distance ?? 12));
    }
    if (a.kind === "offensiveRebound" && SHOTS.has(b.kind)) return (b.distance ?? 0) > 10 ? 1.6 : 0.6;
    if (a.kind === "freeThrow" && b.kind === "freeThrow") return 6.0;
    if (SHOTS.has(a.kind) && made(a) && b.offense != null && b.offense !== a.offense && b.kind !== "foul" && b.kind !== "substitution" && b.kind !== "timeout") {
      return 2.5;
    }
    return AnchorSolver.least;
  },
};

// MARK: - The plan (Phase 0)

/** What the basketball planner needs to know about the game. */
export interface HoopsFacts {
  readonly topIsHome: boolean;
  /** The viewer's turn of the court. */
  readonly flipped: boolean;
  /** The teams as ESPN names them (the parser's). */
  readonly topID: string | null;
  readonly bottomID: string | null;
  readonly topName: string;
  readonly bottomName: string;
}

export const hoopsTeams = (f: HoopsFacts): Teams => ({ topIsHome: f.topIsHome, topID: f.topID, bottomID: f.bottomID, topName: f.topName, bottomName: f.bottomName });
export const hoopsFactsEnds = (f: HoopsFacts, period: number | null): HoopsEnds => hoopsEnds(period ?? 1, f.topIsHome, f.flipped);

export const HoopsPlanner = {
  /** Plays that change nothing on the floor by themselves (they attach to the stoppage they belong to). */
  isAdmin(scene: BasketballScene): boolean {
    return scene.kind === "substitution" || scene.kind === "timeout" || scene.kind === "challenge";
  },

  /**
   * The floor at t as a beat starts from it (`Lineup`, in `side`'s frame):
   * the ten men where each would come to rest from how he's moving, who has
   * the ball, the floor's shape.
   */
  lineup(draft: Plan<HoopsClip>, t: PTime, ends: HoopsEnds, side: Side | null = null): Lineup | null {
    const k = draft.placement(t);
    if (k == null) return null;
    const clip = draft.placements[k]!.clip;
    const offense: Side = side ?? clip.script.side ?? "top";
    const men = TheaterPlanner.men(draft, t).filter((m) => m.figure.group < 2);
    const own = offense === "top" ? 0 : 1;
    // Five a side: mid-substitution the man coming on and the man going off both show; the five most there play.
    const five = (list: typeof men) =>
      [...list]
        .sort((a, b) => b.state.opacity - a.state.opacity || a.state.id - b.state.id)
        .slice(0, 5)
        .sort((a, b) => a.state.id - b.state.id);
    const off = five(men.filter((m) => m.figure.group === own));
    const def = five(men.filter((m) => m.figure.group !== own));
    if (off.length !== 5 || def.length !== 5) return null;
    const right = endsRight(ends, offense);
    const ten = [...off, ...def];
    const at = ten.map((m) => {
      const v = m.state.velocity;
      const speed = Math.hypot(v.x, v.y);
      const ahead = speed > 0.3 ? speed / (2 * 14) : 0;
      const x = Math.min(Math.max(m.state.position.x + v.x * ahead, 1), Hoops.length - 1);
      const y = Math.min(Math.max(m.state.position.y + v.y * ahead, 1), Hoops.width - 1);
      return HoopsWorld.local(v2(x, y), right);
    });
    let holder: number | null = null;
    let ball: Point | null = null;
    const spans = TheaterBake.ballSpans(draft);
    const span = TheaterBake.ballSpan(spans, t);
    if (span?.kind === "clip") {
      const p = draft.placements[span.placement]!;
      const b = p.clip.ball(Math.min(Math.max(p.time(t), 0), p.clip.length));
      if (b?.kind === "held") {
        const id = p.cast[b.figure];
        const i = ten.findIndex((m) => m.state.id === id);
        holder = i >= 0 ? i : null;
      } else if (b?.kind === "free") ball = HoopsWorld.local(v2(b.at.x, b.at.y), right);
    } else if (span?.kind === "held") {
      const i = ten.findIndex((m) => m.state.id === span.actor);
      holder = i >= 0 ? i : null;
    } else if (span?.kind === "flight") ball = HoopsWorld.local(v2(span.flight.to.x, span.flight.to.y), right);
    return { offense, at, holder, ball: holder == null ? ball : null, formation: clip.formation, camera: null, yaw: null };
  },
};

/** Basketball's Phase 0 running order (today's queue, nothing passed over), as clips. */
export class HoopsSequencer implements ClipSequencer<HoopsClip, BasketballUnit> {
  /** Who has the ball, and the court between plays the last telling left. */
  possession: Side | null;
  toldRest: RestSpec | null = null;
  readonly limits = MotionLimits.basketball;
  readonly yawRule = basketballYaw;
  private inputs: AnchorInput[] | null = null;

  constructor(
    readonly plays: readonly TimelinePlay<BasketballScene>[],
    readonly history: ReadonlySet<string>,
    readonly facts: HoopsFacts,
  ) {
    let possession: Side | null = null;
    for (const p of plays) {
      if (!history.has(p.id)) continue;
      const after = afterSide(p.play);
      if (after != null) possession = after;
    }
    this.possession = possession;
  }

  get anchorInputs(): readonly AnchorInput[] {
    this.inputs ??= HoopsAnchors.inputs(this.plays);
    return this.inputs;
  }

  units(handled: ReadonlySet<string>): TellUnit<BasketballUnit>[] {
    const news = this.plays.map((p) => p.play).filter((s) => !this.history.has(s.id));
    return basketballUnits(news, handled).map((u) =>
      tellUnit(u.scene.id, u, { covers: u.covers, admin: HoopsPlanner.isAdmin(u.scene), fromWorld: !isMarquee(u), lead: isMarquee(u) ? 0.9 : 0.5 }),
    );
  }

  opening(): HoopsClip {
    const scenes = this.plays.map((p) => p.play);
    let last: BasketballScene | null = null;
    for (const s of scenes) if (this.history.has(s.id) && s.kind !== "substitution") last = s;
    const rest = restAfter(last, null, null, hoopsFactsEnds(this.facts, last?.period ?? scenes[0]?.period ?? null), last ? (afterSide(last) ?? last.offense) : null);
    this.toldRest = rest;
    return new HoopsClip(restScript(rest), null, "rest", rest);
  }

  resume(kept: readonly ClipPlacement<HoopsClip>[]): void {
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i]!.clip.kind !== "rest") continue;
      const rest = kept[i]!.clip.rest;
      if (rest) this.toldRest = rest;
      break;
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      const scene = kept[i]!.clip.scene;
      if (!scene) continue;
      const after = afterSide(scene);
      if (after != null) this.possession = after;
      break;
    }
  }

  clip(unit: TellUnit<BasketballUnit>, t: PTime, draft: Plan<HoopsClip>): HoopsClip {
    const scene = unit.scene.scene;
    const ends = hoopsFactsEnds(this.facts, scene.period);
    if (isMarquee(unit.scene)) return new HoopsClip(BasketballScript.play(scene, endsRight(ends, scene.offense)), scene, "replay");
    const lineup = HoopsPlanner.lineup(draft, t, ends);
    return new HoopsClip(beatScript(scene, unit.scene.group, ends, lineup, this.possession), scene, "beat");
  }

  told(unit: TellUnit<BasketballUnit>): void {
    const after = afterSide(unit.scene.scene);
    if (after != null) this.possession = after;
  }

  rest(unit: TellUnit<BasketballUnit>, t: PTime, draft: Plan<HoopsClip>): HoopsClip {
    const scene = unit.scene.scene;
    const ends = hoopsFactsEnds(this.facts, scene.period);
    const rest = { ...restAfter(scene, this.toldRest, HoopsPlanner.lineup(draft, t, ends, afterSide(scene) ?? this.possession), ends, this.possession), ends };
    this.toldRest = rest;
    return new HoopsClip(restScript(rest), null, "rest", rest);
  }

  next(clip: HoopsClip, t: PTime, draft: Plan<HoopsClip>): HoopsClip {
    let next: RestSpec = clip.rest ?? this.toldRest ?? restOf({ offense: this.possession });
    if (clip.kind === "rest") next = { ...next, round: next.round + 1, phase: isInbound(next.phase) ? "live" : next.phase };
    next = { ...next, from: HoopsPlanner.lineup(draft, t, next.ends, next.offense) };
    this.toldRest = next;
    return new HoopsClip(restScript(next), null, "rest", next);
  }

  cues(unit: TellUnit<BasketballUnit>, _clip: HoopsClip, decisive: PTime): Cue[] {
    const scene = unit.scene.scene;
    if (!made(scene) || !(scene.points > 0)) return [];
    return [{ at: decisive, until: decisive + 3, kind: { kind: "scored", play: scene.id }, source: { kind: "known", play: scene.id } }];
  }

  handOff(draft: Plan<HoopsClip>, k: number): void {
    TheaterHandOff.ball(draft, k, 40, 4.4);
  }
}

/** Basketball on the director (Phase 0): today's scripts as clips. */
export const HoopsSport: TheaterSport<HoopsClip, BasketballScene, HoopsFacts> = {
  sceneContext: () => 0,
  sameContext: (a, b) => a === b,
  sameFacts: (a, b) => sameFields(a, b),
  /**
   * The furthest a scene reads ahead: twelve plays at the same clock for a
   * foul's free throws, four court plays (past any substitutions and
   * timeouts) for a miss's rebound.
   */
  sceneReach: 20,

  sceneStart(first: number, json: readonly JSONValue[]): number {
    // reboundAfter reads four court plays, skipping any number of substitutions/timeouts.
    // A raw-row bound alone can leave a miss cached without its newly arrived rebound.
    let from = Math.max(first - 20, 0);
    let court = 0;
    for (let i = first - 1; i >= 0; i--) {
      if (!ADMIN.has(typeOf(json[i]) ?? 0)) court += 1;
      from = Math.min(from, i);
      if (court === 4) break;
    }
    return from;
  },

  /** A play's scene reads the plays around it (the shot before a rebound, the free throws after a foul). */
  scene(_raw: readonly RawPlay[], json: readonly JSONValue[], i: number, _pending: boolean, facts: HoopsFacts): BasketballScene | null {
    return parseScene(json, i, hoopsTeams(facts));
  },

  plan(plays, history, facts, chain: PlanChain<HoopsClip>, c, shift, deferFrom, revision, ids: ActorIDs): Plan<HoopsClip> {
    return TheaterPlanner.plan(new HoopsSequencer(plays, history, facts), history, chain, c, shift, deferFrom, revision, ids);
  },

  horizons: HoopsAnchors.horizons,
};
