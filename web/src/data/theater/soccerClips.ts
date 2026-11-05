/**
 * The soccer theater on the choreography engine, Phase 0 (SoccerClips.swift;
 * CHOREOGRAPHY §12): today's scripts (a moment's replay with its build-up, an
 * event's beat, the ball going round between moments) become clips placed at
 * their entries' anchors, every hand-off a splice from where everyone is. The
 * world frame is the pitch as drawn (metres, home attacking right by the half
 * and the viewer's turn): every script is already laid out in it, so nothing
 * turns. The camera is the main stand camera's framing; the reverse angle
 * behind a goal in a goal's replay is broadcast grammar, kept as a declared
 * device.
 *
 * Web: the Mac's lane turns a match's plays from ESPN's older form into the
 * current one as it reads them (OlderSoccerPlays), so its director reads
 * current ones; here the plays stay as ESPN sent them and every parser takes
 * the match's scale (`pitchScale`), so the scene context carries it beside
 * the keepers.
 *
 * The painter (`PitchPainter`) is the drawing's: features/game/soccer/theater/directedPitch.ts.
 */
import type { JSONValue } from "../json";
import { pitchScale, type PitchScale } from "../liveFeeds/soccer";
import type { Side } from "../models";
import type { Point } from "../mlb/theaterField";
import { eventBeat, eventHolds, parseEvent, parseTouch, PitchFacing, sameSoccerIdle, soccerIdle, soccerIdleScript, turnedScene, type SoccerEvent, type SoccerIdle, type SoccerTouch } from "./soccerIdle";
import { isMoment, keepers, parse, scored, type Lineups, type Person, type SoccerScene } from "./soccerScene";
import { buildUpPace, SoccerScript, type ActionKind } from "./soccerScript";
import type { AnchorInput } from "./theaterAnchors";
import { ClipFades, ClipPaths, TheaterPlanner, tellUnit, type ActorIDs, type ClipBall, type ClipFigure, type ClipPlacement, type ClipSequencer, type TellUnit, type TheaterClip } from "./theaterClips";
import { reachBack, SceneCache, sameFields, type TheaterSport } from "./theaterDirector";
import { length2, MotionLimits, v2, vec4, type Cue, type PTime, type Vec4 } from "./theaterEngine";
import type { MotionPath } from "./theaterMotion";
import type { Plan, PlanChain } from "./theaterPlanChain";
import type { RawPlay, TimelinePlay, TimelineSnapshot } from "./theaterSource";

/** A man's moments with the ball, his path keeps exactly where they were. */
const CONTACTS: ReadonlySet<ActionKind> = new Set(["kick", "header", "control", "throwIn", "gather", "aerial", "punch", "claim"]);
/** The acts he holds once he's made them: he keeps facing what they face. */
const HELD: ReadonlySet<ActionKind> = new Set(["gather", "celebrate", "dejected"]);

export type PitchClipKind = "moment" | "idle";

/** One of today's soccer scripts as the engine places it: a moment's replay, or the pitch between moments. */
export class PitchClip implements TheaterClip {
  readonly kind: PitchClipKind;
  readonly figures: readonly ClipFigure[];
  readonly length: number;
  readonly still: number;
  readonly decisive: number | null;
  readonly essential: number;
  /** Each figure's path re-made through the motion layer (ClipPaths). */
  readonly paths: readonly (MotionPath | null)[];
  /** The men who still can't make it, faded through (ClipFades). */
  readonly fades: ClipFades;

  constructor(
    readonly script: SoccerScript,
    readonly scene: SoccerScene | null,
    readonly idle: SoccerIdle | null,
    readonly attacking: Side,
  ) {
    this.kind = idle == null ? "moment" : "idle";
    this.figures = script.actors.map((a) => {
      const group = a.team === "attacking" ? (attacking === "top" ? 0 : 1) : a.team === "defending" ? (attacking === "top" ? 1 : 0) : 2;
      return {
        group,
        kind: a.role === "keeper" ? "keeper" : a.team === "official" ? "official" : "",
        athlete: a.athlete,
        band: a.team === "official" || a.team === "staff" ? "official" : a.role === "keeper" ? "keeper" : "outfield",
        height: 2.5,
      };
    });
    const bands = this.figures.map((f) => MotionLimits.soccer.band(f.band));
    // The ball going round loops: a man's moments at the loop's seam stay where they are, so its ends meet.
    const loop = script.loop;
    const seams = loop ? [loop.start, loop.start + loop.period] : [];
    this.paths = script.actors.map((a, i) => {
      // A keeper's dive is the script's own (his hands go exactly to the ball): his path stays the script's throughout.
      if (a.dive != null) return null;
      const contacts = a.actions.filter((x) => CONTACTS.has(x.kind)).map((x) => x.at);
      return ClipPaths.resynthesized(a.moves, contacts, bands[i]!, { lower: 0, upper: Math.max(script.duration, 0) }, (t) => a.position(t), true, seams);
    });
    this.length = idle == null ? script.duration : Infinity;
    // Whoever still can't make a moment's run fades through it (declared, counted).
    const paths = this.paths;
    this.fades =
      idle != null
        ? ClipFades.none
        : ClipFades.make(paths.length, script.duration, bands, (i, t) => {
            const path = paths[i];
            const dive = script.actors[i]!.dive;
            if (!path || !(dive ? t < dive.start : true)) return 0;
            return length2(path.velocity(t));
          });
    this.still = idle == null ? script.leadIn : 0;
    this.decisive = idle == null ? (script.impacts.find((x) => x.kind === "net")?.at ?? script.arrive) : null;
    this.essential = idle == null ? Math.min(this.length, (this.decisive ?? 0) + 1.5) : 0;
  }

  /** The script's time at the clip's time `t`: a moment holds its end; the ball going round loops. */
  local(t: number): number {
    const duration = this.script.duration;
    if (this.kind !== "idle") return Math.min(Math.max(t, 0), duration);
    const loop = this.script.loop;
    if (!loop || !(loop.period > 0) || !(t > loop.start + loop.period)) return Math.min(Math.max(t, 0), duration);
    // (Swift's truncatingRemainder: JS's `%`.)
    return loop.start + ((t - loop.start) % loop.period);
  }

  get ambient(): boolean {
    return this.kind === "idle";
  }

  position(figure: number, t: number): Point {
    const u = this.local(t);
    const path = this.paths[figure];
    const dive = this.script.actors[figure]!.dive;
    if (path && (dive ? u < dive.start : true)) return path.position(u);
    const p = this.script.actors[figure]!.position(u);
    return v2(p.x, p.y);
  }

  /**
   * Which way he faces: where he's going, else what he watches (the act he's
   * at, his look, the ball), as today's stride measured it; the director's own
   * stride turns him toward it at a man's rate.
   */
  heading(figure: number, t: number): number {
    const u = this.local(t);
    const track = this.script.rig[figure];
    if (track) return track.motion(u).heading;
    const a = this.script.actors[figure]!;
    const m = a.motion(u);
    if (m) return Math.atan2(m.heading.y, m.heading.x);
    const at = a.position(u);
    let point: Point | null = null;
    for (let i = a.actions.length - 1; i >= 0; i--) {
      const x = a.actions[i]!;
      if (u > x.at - 0.45 && (u < x.at + 0.2 || HELD.has(x.kind))) {
        point = x.toward;
        break;
      }
    }
    point ??= a.looks.findLast((l) => u >= l.from)?.point ?? null;
    if (point == null) {
      const b = this.script.ball(u);
      point = b ? v2(b.x, b.y) : null;
    }
    if (!point || !(Math.hypot(point.x - at.x, point.y - at.y) > 1e-6)) return a.team === "attacking" ? 0 : Math.PI;
    return Math.atan2(point.y - at.y, point.x - at.x);
  }

  opacity(figure: number, t: number): number {
    return this.script.actors[figure]!.opacity(this.local(t)) * this.fades.opacity(figure, t);
  }

  ball(t: number): ClipBall | null {
    const u = this.local(t);
    const b = this.script.ball(u);
    if (!(this.script.ballOpacity(u) > 0.01) || !b) return null;
    const flying = this.script.flights.some((f) => u > f.start && u < f.end);
    return { kind: "free", at: { x: b.x, y: b.y, z: b.z }, flying };
  }

  camera(t: number): Vec4 {
    const f = this.script.frame(this.local(t)).camera;
    return vec4(f.x, f.y, Math.log(Math.max(f.span, 1e-3)), 0);
  }

  moving(t: number): boolean {
    if (!(t >= 0)) return false;
    if (this.kind === "moment") return t <= this.length;
    const u = this.local(t);
    return this.script.beats.some(([a, b]) => u >= a && u <= b) || this.script.loop != null;
  }
}

// MARK: - The plan (Phase 0)

/** What the soccer planner needs to know about the match. */
export interface PitchFacts {
  readonly homeTeamID: string | null;
  readonly flipped: boolean;
  readonly lineups: Lineups;
  /**
   * The game's at a break. ESPN can post the half-time entry a quarter of an
   * hour after its status says so: the teams don't wait for it.
   */
  readonly atBreak: boolean;
}

/**
 * A soccer entry as the planner reads it: a moment (a shot, a goal, a save),
 * an event with a beat, or a touch that moves the ball's whereabouts (the
 * field between moments follows it).
 */
export type PitchPlay =
  | { readonly kind: "moment"; readonly scene: SoccerScene }
  | { readonly kind: "event"; readonly event: SoccerEvent }
  | { readonly kind: "touch"; readonly touch: SoccerTouch };

/** What every moment's scene reads from the whole timeline: the keepers it names, and (web) the match's scale. */
export interface PitchContext {
  readonly keepers: Readonly<Record<string, Person>>;
  readonly scale: PitchScale;
}

/** The context of a timeline's plays. */
export function pitchContext(json: readonly JSONValue[]): PitchContext {
  return { keepers: keepers(json), scale: pitchScale(json) ?? "percent" };
}

/** Two contexts are the same (Swift's `Equatable` on `[String: SoccerScene.Person]`). */
export function samePitchContext(a: PitchContext, b: PitchContext): boolean {
  if (a.scale !== b.scale) return false;
  const ka = Object.keys(a.keepers);
  if (ka.length !== Object.keys(b.keepers).length) return false;
  for (const k of ka) {
    const x = a.keepers[k];
    const y = b.keepers[k];
    if (y === undefined || JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}

/** An entry as the planner reads it (with the plays before it and after), or null. */
function pitchPlay(json: readonly JSONValue[], i: number, facts: PitchFacts, context: PitchContext): PitchPlay | null {
  const item = json[i];
  if (item === undefined) return null;
  if (isMoment(item)) {
    const scene = parse(json, i, facts.homeTeamID, context.keepers, context.scale);
    if (scene) return { kind: "moment", scene };
  }
  const event = parseEvent(json, i, facts.homeTeamID, i, context.scale);
  if (event) return { kind: "event", event };
  const touch = parseTouch(item, facts.homeTeamID, i, context.scale);
  return touch ? { kind: "touch", touch } : null;
}

export const PitchPlanner = {
  /** The timeline's entries as moments, events and touches, through today's parsers (each with the plays before it). */
  plays(snapshot: TimelineSnapshot<RawPlay>, facts: PitchFacts): TimelinePlay<PitchPlay>[] {
    return new SceneCache(PitchSport).read(snapshot, facts);
  },
};

/** Two idles are the same (Swift's synthesized `SoccerIdle ==`: the event whole, not only its ID). */
function sameIdle(a: SoccerIdle, b: SoccerIdle): boolean {
  return sameSoccerIdle(a, b) && (a.event === b.event || JSON.stringify(a.event) === JSON.stringify(b.event));
}

/**
 * The ball going round as clips, kept: the same field (`SoccerIdle`) makes
 * the same clip, and every plan places the field between plays again, so
 * building its script (the men's runs, their strides) once per field, not per
 * plan, is most of a soccer plan's time saved. The newest few. (Plans run one
 * at a time on the web's main thread: no lock.)
 */
export const PitchIdleClips = {
  most: 48,
  kept: [] as [SoccerIdle, PitchClip][],
  /** The bench's counts. */
  hits: 0,
  misses: 0,

  clip(idle: SoccerIdle): PitchClip {
    const list = PitchIdleClips.kept;
    const hit = list.find(([kept]) => sameIdle(kept, idle));
    if (hit) {
      PitchIdleClips.hits += 1;
      return hit[1];
    }
    PitchIdleClips.misses += 1;
    const clip = new PitchClip(soccerIdleScript(idle, false), null, idle, idle.possession);
    list.push([idle, clip]);
    if (list.length > PitchIdleClips.most) list.splice(0, list.length - PitchIdleClips.most);
    return clip;
  },
};

/** The break the status says it is, where the plays haven't logged it yet. */
const BREAK_ID = "status-break";

/**
 * Soccer's Phase 0 running order: each moment its replay, each event with a
 * beat its beat, the ball going round between them shaped by where it is (a
 * change of cell is a splice now, not a crossfade: S1); nothing passed over.
 */
export class PitchSequencer implements ClipSequencer<PitchClip, PitchPlay> {
  readonly limits = MotionLimits.soccer;
  readonly yawRule = null;
  last: SoccerScene | null = null;
  event: SoccerEvent | null = null;
  touch: SoccerTouch | null = null;
  period: number | null = null;
  private inputs: AnchorInput[] | null = null;

  constructor(
    readonly plays: readonly TimelinePlay<PitchPlay>[],
    readonly history: ReadonlySet<string>,
    readonly facts: PitchFacts,
  ) {}

  /** A copy (Swift's value semantics: `var copy = self`). */
  private copy(): PitchSequencer {
    const c = new PitchSequencer(this.plays, this.history, this.facts);
    c.last = this.last;
    c.event = this.event;
    c.touch = this.touch;
    c.period = this.period;
    c.inputs = this.inputs;
    return c;
  }

  get anchorInputs(): readonly AnchorInput[] {
    this.inputs ??= this.plays.map((p) => {
      const live = p.play.kind !== "event";
      return {
        id: p.id,
        period: p.period,
        eventTime: p.eventTime,
        bounds: p.eventBounds,
        elapsed: p.clock.elapsed,
        resolution: 1,
        live,
        stopsClock: false,
        weight: live ? 1 : 0.5,
        gapAfter: 0.3,
        restartAfter: 1,
      };
    });
    return this.inputs;
  }

  idle(): PitchClip {
    const idle = soccerIdle({
      event: this.facts.atBreak && !this.atBreakAlready ? PitchSequencer.halfTime(this.period) : this.event,
      touch: this.touch,
      scene: this.last,
      period: this.period,
      lineups: this.facts.lineups,
      flipped: this.facts.flipped,
    });
    return PitchIdleClips.clip(idle);
  }

  static readonly breakID = BREAK_ID;

  /** The break the status says it is, where the plays haven't logged it yet. */
  static halfTime(period: number | null): SoccerEvent {
    return {
      id: BREAK_ID,
      kind: { type: "halftime" },
      side: null,
      player: null,
      athlete: null,
      other: null,
      otherAthlete: null,
      at: null,
      penalty: false,
      minute: "",
      clock: 0,
      period,
      text: "",
      wallclock: null,
      // (Swift's `Int.max`.)
      order: Number.MAX_SAFE_INTEGER,
    };
  }

  /** The running order's own event says it's a break. */
  private get atBreakAlready(): boolean {
    return this.event?.kind.type === "halftime" || this.event?.kind.type === "fullTime";
  }

  /** A half-time entry among the plays known. */
  private get loggedBreak(): boolean {
    return this.plays.some((p) => p.play.kind === "event" && p.play.event.kind.type === "halftime" && p.play.event.period === this.period);
  }

  /** The cell the ball's in (today's idle key: a 15 × 17 m cell, the side on it, the half). */
  static cell(t: SoccerTouch): string {
    return `${Math.trunc(t.at.x / 15)},${Math.trunc(t.at.y / 17)}|${t.side}|${t.period ?? 1}`;
  }

  units(handled: ReadonlySet<string>): TellUnit<PitchPlay>[] {
    const out: TellUnit<PitchPlay>[] = [];
    let cell = this.touch ? PitchSequencer.cell(this.touch) : null;
    for (const p of this.plays) {
      if (handled.has(p.id) || this.history.has(p.id)) continue;
      const play = p.play;
      switch (play.kind) {
        case "moment":
          out.push(tellUnit(p.id, play, { fromWorld: false, lead: 1.2 }));
          break;
        case "event": {
          const e = play.event;
          if (!(eventBeat(e.kind) > 0) || e.kind.type === "resume") continue;
          // The teams already went off at the status's word: they don't again at the entry's.
          if (e.kind.type === "halftime" && handled.has(BREAK_ID)) continue;
          out.push(tellUnit(p.id, play, { admin: true, fromWorld: true, lead: 0.3 }));
          break;
        }
        case "touch": {
          const next = PitchSequencer.cell(play.touch);
          if (next === cell) continue;
          cell = next;
          out.push(tellUnit(p.id, play, { fromWorld: true, lead: 0 }));
          break;
        }
      }
    }
    if (this.facts.atBreak && !this.atBreakAlready && !this.loggedBreak && !handled.has(BREAK_ID)) {
      out.push(tellUnit<PitchPlay>(BREAK_ID, { kind: "event", event: PitchSequencer.halfTime(this.period) }, { admin: true, fromWorld: true, lead: 0.3 }));
    }
    return out;
  }

  absorb(play: PitchPlay): void {
    switch (play.kind) {
      case "moment":
        this.last = play.scene;
        this.event = null;
        this.period = play.scene.period ?? this.period;
        break;
      case "event":
        this.event = eventHolds(play.event.kind) ? play.event : null;
        this.period = play.event.period ?? this.period;
        break;
      case "touch":
        this.touch = play.touch;
        if (this.event && !eventHolds(this.event.kind)) this.event = null;
        this.period = play.touch.period ?? this.period;
        break;
    }
  }

  opening(): PitchClip {
    for (const p of this.plays) if (this.history.has(p.id)) this.absorb(p.play);
    return this.idle();
  }

  resume(kept: readonly ClipPlacement<PitchClip>[]): void {
    for (const p of this.plays) {
      if (this.history.has(p.id) || kept.some((k) => k.covers.includes(p.id))) this.absorb(p.play);
    }
  }

  clip(unit: TellUnit<PitchPlay>): PitchClip {
    const play = unit.scene;
    if (play.kind === "moment") {
      const scene = play.scene;
      const drawn = PitchFacing.homeAttacksRight(scene.period, this.facts.flipped) ? scene : turnedScene(scene);
      return new PitchClip(SoccerScript.build(drawn, this.facts.lineups, buildUpPace, false), drawn, null, drawn.side);
    }
    const copy = this.copy();
    copy.absorb(play);
    return copy.idle();
  }

  told(unit: TellUnit<PitchPlay>): void {
    this.absorb(unit.scene);
  }

  rest(): PitchClip {
    return this.idle();
  }

  next(): PitchClip {
    return this.idle();
  }

  cues(unit: TellUnit<PitchPlay>, _clip: PitchClip, decisive: PTime): Cue[] {
    const play = unit.scene;
    if (play.kind !== "moment" || !scored(play.scene)) return [];
    const id = play.scene.id;
    return [{ at: decisive, until: decisive + 3, kind: { kind: "scored", play: id }, source: { kind: "known", play: id } }];
  }

  handOff(): void {}
}

/** Soccer on the director (Phase 0): today's scripts as clips. */
export const PitchSport: TheaterSport<PitchClip, PitchPlay, PitchFacts, PitchContext> = {
  /** The keepers every moment's scene names (read from the whole timeline). */
  sceneContext: (json) => pitchContext(json as readonly JSONValue[]),
  sameContext: samePitchContext,
  sameFacts: (a, b) => sameFields(a, b),
  /** A moment reads the 30 plays before it and the 6 after (`PitchPlanner.plays`). */
  sceneReach: 32,
  sceneStart: reachBack(32),

  scene(_raw, json, i, _pending, facts, context): PitchPlay | null {
    return pitchPlay(json as readonly JSONValue[], i, facts, context);
  },

  plan(plays, history, facts, chain: PlanChain<PitchClip>, c, shift, deferFrom, revision, ids: ActorIDs): Plan<PitchClip> {
    return TheaterPlanner.plan(new PitchSequencer(plays, history, facts), history, chain, c, shift, deferFrom, revision, ids);
  },

  /** A shot or a goal's horizon (its build-up before the strike); the ball going round and the events none. */
  horizons: { shot: 4.0, entry: 1.0 },
};
