/**
 * The baseball theater on the choreography engine, Phase 0
 * (BaseballClips.swift; CHOREOGRAPHY §12): today's scripts (a play's replay,
 * a pitch's beat, the field between pitches) become clips placed at their
 * entries' anchors (MLB's own pitch times when the timeline has them), every
 * hand-off a splice from where everyone is. The ballpark is the world frame
 * (nothing turns); the camera is today's framings as targets, without yaw.
 * Today's approved play pace is kept (§11.4): the motion limits scale with it.
 *
 * The painter (`DiamondPainter`) is the drawing's: features/game/mlb/theater/directedField.ts.
 */
import type { Side } from "../models";
import { anchorInput, type AnchorInput } from "../theater/theaterAnchors";
import { ClipPaths, TheaterPlanner, tellUnit, type ActorIDs, type ClipBall, type ClipFigure, type ClipPlacement, type ClipSequencer, type TellUnit, type TheaterClip } from "../theater/theaterClips";
import { reachBack, type TheaterSport } from "../theater/theaterDirector";
import { MotionLimits, vec4, type Cue, type PTime, type Span, type Vec4 } from "../theater/theaterEngine";
import type { MotionPath } from "../theater/theaterMotion";
import type { Plan, PlanChain } from "../theater/theaterPlanChain";
import type { RawPlay, TimelinePlay } from "../theater/theaterSource";
import { seed64 } from "../theater/splitMix64";
import { batting as battingOf, isPlayBeat, stands, timeline, type Delay, type PlayBeat } from "./playBeat";
import { beatScript } from "./playBeatScript";
import { parse, type PlayScene } from "./playScene";
import { PlayScript, restAfter, type Rest } from "./playScript";
import type { Point } from "./theaterField";

// MARK: - Clips

export type DiamondClipKind = "play" | "beat" | "rest";

/** One of today's baseball scripts as the engine places it: a play's replay, a pitch's beat, or the field between pitches. */
export class DiamondClip implements TheaterClip {
  readonly figures: readonly ClipFigure[];
  readonly length: number;
  readonly still: number;
  readonly decisive: number | null;
  readonly essential: number;
  /** Each figure's path re-made through the motion layer (ClipPaths). */
  readonly paths: readonly (MotionPath | null)[];
  /** The field between pitches: when anyone's moving in its quiet. */
  private readonly quietBeats: readonly Span[];

  static readonly limits = MotionLimits.baseball(2.5);

  constructor(
    readonly script: PlayScript,
    readonly scene: PlayScene | null,
    readonly beat: PlayBeat | null,
    readonly kind: DiamondClipKind,
    readonly batting: Side,
  ) {
    this.figures = script.actors.map((a) => {
      const group = a.team === "batting" ? (batting === "top" ? 0 : 1) : a.team === "fielding" ? (batting === "top" ? 1 : 0) : 2;
      const kind = a.role.kind === "fielder" ? `fielder${a.role.n}` : a.role.kind;
      return { group, kind, athlete: null, band: a.team === "official" ? "official" : a.team === "batting" ? "runner" : "fielder", height: 8.5 };
    });
    const bands = this.figures.map((f) => DiamondClip.limits.band(f.band));
    const span = { lower: 0, upper: Math.max(script.duration, 0) };
    this.paths = script.actors.map((a, i) => {
      if (a.dive != null || a.slide != null) return null;
      return ClipPaths.resynthesized(
        a.moves,
        a.actions.map((x) => x.at),
        bands[i]!,
        span,
        (t) => a.position(t),
      );
    });
    this.quietBeats = kind === "rest" ? script.actors.flatMap((a) => a.moves.map((m) => ({ lower: m.start, upper: m.end + 0.2 }))) : [];
    this.length = kind === "rest" ? Infinity : script.duration;
    this.still = 0;
    this.decisive = kind === "rest" ? null : (script.fence?.at ?? (script.release != null ? script.release + 0.45 : null) ?? script.flashes[0]?.at ?? null);
    this.essential = kind === "rest" ? 0 : Math.min(this.length, (this.decisive ?? 0) + 1.0);
  }

  /** The script's time at the clip's time `t`: a play holds its end; the field between pitches goes round its quiet. */
  local(t: number): number {
    if (this.kind !== "rest") return Math.min(Math.max(t, 0), this.script.duration);
    return this.script.duration > 0 ? Math.max(t, 0) % this.script.duration : 0;
  }

  get ambient(): boolean {
    return this.kind === "rest";
  }

  position(figure: number, t: number): Point {
    const u = this.local(t);
    const path = this.paths[figure];
    if (path) return path.position(u);
    return this.script.actors[figure]!.position(u);
  }

  heading(figure: number, t: number): number {
    const track = this.script.rig[figure];
    return track ? track.motion(this.local(t)).heading : 0;
  }

  opacity(figure: number, t: number): number {
    return this.script.actors[figure]!.opacity(this.local(t));
  }

  ball(t: number): ClipBall | null {
    const u = this.local(t);
    if (!(this.script.ballOpacity(u) > 0.01)) return null;
    const b = this.script.ball(u);
    if (!b) return null;
    return { kind: "free", at: { x: b.x, y: b.y, z: b.z }, flying: this.script.flights.some((f) => u > f.start && u < f.end) };
  }

  camera(t: number): Vec4 {
    const f = this.script.camera.frame(this.local(t));
    return vec4(f.x, f.y, Math.log(Math.max(f.span, 1e-3)), 0);
  }

  moving(t: number): boolean {
    if (!(t >= 0)) return false;
    if (this.kind !== "rest") return t <= this.length;
    const u = this.local(t);
    return this.quietBeats.some((s) => u >= s.lower && u <= s.upper);
  }
}

// MARK: - The plan (Phase 0)

/** What the baseball planner needs to know about the game. */
export interface DiamondFacts {
  readonly topID: string | null;
  readonly bottomID: string | null;
  /** The box score's names (the timeline's beats name who came in by them). */
  readonly names: Readonly<Record<string, string>>;
  /** The game's held up, in ESPN's words ("Rain Delay"): the tarp's out. */
  readonly heldUp: string | null;
}

/** The side a team ID bats in (MLB's visitors in the top). */
export function diamondSide(facts: DiamondFacts, id: string | null | undefined): Side | null {
  const team = id ?? null;
  return team === facts.topID ? "top" : team === facts.bottomID ? "bottom" : null;
}

/** Two facts the same (Swift's synthesized `Equatable`: the names by value). */
export function sameDiamondFacts(a: DiamondFacts, b: DiamondFacts): boolean {
  if (a.topID !== b.topID || a.bottomID !== b.bottomID || a.heldUp !== b.heldUp) return false;
  if (a.names === b.names) return true;
  const ka = Object.keys(a.names);
  if (ka.length !== Object.keys(b.names).length) return false;
  return ka.every((k) => a.names[k] === b.names[k]);
}

/** ESPN's ID of an entry (Swift `JSON.string`, which reads a number too). */
function entryID(json: unknown): string | null {
  const v = (json as { id?: unknown } | null)?.id;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const HELD_ID = "status-delay";
const OVER_ID = "status-delay-over";

/** A beat the timeline doesn't log (ESPN's status says it): a delay, and its end. */
function delayBeat(id: string, delay: Delay): PlayBeat {
  return { id, kind: { kind: "delay", delay }, bats: null, arm: null, inning: null, top: null, balls: 0, strikes: 0, outs: 0, wallclock: null, bases: null, news: false };
}

/**
 * Baseball's Phase 0 running order: today's per-pitch timeline (PlayBeat):
 * each pitch its beat, each play its replay, the field between pitches
 * between them; nothing passed over (`catchUp` is gone).
 */
export class DiamondSequencer implements ClipSequencer<DiamondClip, PlayBeat> {
  readonly beats: PlayBeat[];
  last: PlayBeat | null = null;
  lastPlay: PlayScene | null = null;
  readonly limits = DiamondClip.limits;
  readonly yawRule = null;
  private inputs: AnchorInput[] | null = null;

  constructor(
    readonly plays: readonly TimelinePlay<RawPlay>[],
    readonly history: ReadonlySet<string>,
    readonly facts: DiamondFacts,
  ) {
    this.beats = timeline(
      plays.map((p) => p.play.json),
      [],
      facts.names,
    );
  }

  get anchorInputs(): readonly AnchorInput[] {
    this.inputs ??= this.plays.map((p) =>
      anchorInput({
        id: p.id,
        period: p.period,
        eventTime: p.eventTime,
        bounds: p.eventBounds,
        elapsed: null,
        live: p.kind.phase === "live",
        stopsClock: false,
        weight: p.kind.phase === "live" ? 1 : 0.5,
        gapAfter: p.kind.label === "pitch" ? 6 : 1,
      }),
    );
    return this.inputs;
  }

  /** A beat's entry: its anchor is that play's (ESPN's ID before any ".change"/".review" suffix). */
  static entry(beat: PlayBeat): string {
    // (Swift's `split` drops empty pieces.)
    return beat.id.split(".").find((s) => s.length > 0) ?? beat.id;
  }

  units(handled: ReadonlySet<string>): TellUnit<PlayBeat>[] {
    const units = this.beats
      .filter((b) => !handled.has(b.id) && !this.history.has(DiamondSequencer.entry(b)))
      .map((b) => tellUnit(b.id, b, { admin: stands(b), fromWorld: true, lead: isPlayBeat(b) ? 0.9 : 0.4, anchor: DiamondSequencer.entry(b) }));
    // ESPN's plays don't log a delay, only its status does: the tarp out at its word, and off once it's over.
    let delay: Delay | null;
    const words = this.facts.heldUp;
    if (words != null) {
      delay = handled.has(HELD_ID) ? null : { kind: "weather", why: words.toLowerCase().includes("rain") ? "Rain" : words };
    } else {
      delay = handled.has(HELD_ID) && !handled.has(OVER_ID) ? { kind: "over" } : null;
    }
    if (delay) {
      const id = delay.kind === "over" ? OVER_ID : HELD_ID;
      units.unshift(tellUnit(id, delayBeat(id, delay), { admin: true, fromWorld: true, lead: 0.4 }));
    }
    return units;
  }

  /** The batting side for a beat (between halves, the one about to bat; after a third out, the other). */
  batting(b: PlayBeat | null): Side {
    if (!b) return "top";
    const k = b.kind;
    if (k.kind === "inningBreak") return k.middle ? "bottom" : "top";
    if (k.kind === "play" && b.outs >= 3) return b.top === false ? "top" : "bottom";
    return battingOf(b) ?? "top";
  }

  restFor(b: PlayBeat | null): Rest {
    if (!b) return { bases: [false, false, false], bats: null, swapped: false, fieldingHome: true };
    const side = this.batting(b);
    const noBatter = b.kind.kind === "inningBreak";
    return { bases: noBatter ? [false, false, false] : (b.bases ?? [false, false, false]), bats: noBatter ? null : b.bats, swapped: false, fieldingHome: side === "top" };
  }

  scene(b: PlayBeat): PlayScene | null {
    const items = this.plays.map((p) => p.play.json);
    const entry = DiamondSequencer.entry(b);
    const i = items.findIndex((j) => entryID(j) === entry);
    if (i < 0) return null;
    return parse(items, i, (id) => diamondSide(this.facts, id), this.facts.names);
  }

  field(_t: PTime): DiamondClip {
    let rest = this.lastPlay ? restAfter(this.lastPlay, null, this.last?.bats ?? null, this.lastPlay.batting) : this.restFor(this.last);
    if (this.facts.heldUp != null) rest = { ...rest, standing: { kind: "tarp" } };
    return new DiamondClip(PlayScript.quiet(rest, seed64(this.last?.id ?? "field")), null, null, "rest", this.batting(this.last));
  }

  opening(t: PTime): DiamondClip {
    this.last = this.beats.findLast((b) => this.history.has(DiamondSequencer.entry(b))) ?? null;
    return this.field(t);
  }

  resume(kept: readonly ClipPlacement<DiamondClip>[]): void {
    const placed = kept.findLast((p) => p.play != null);
    if (placed) this.last = this.beats.find((b) => b.id === placed.play) ?? placed.clip.beat;
  }

  clip(unit: TellUnit<PlayBeat>, _t: PTime, _draft: Plan<DiamondClip>): DiamondClip {
    const b = unit.scene;
    const scene = isPlayBeat(b) ? this.scene(b) : null;
    if (scene) {
      const rest: Rest = { bases: scene.basesBefore, bats: scene.bats, swapped: false, fieldingHome: this.batting(b) === "top" };
      return new DiamondClip(PlayScript.play(scene, rest), scene, b, "play", scene.batting ?? this.batting(b));
    }
    return new DiamondClip(beatScript(b, this.restFor(b)), null, b, "beat", this.batting(b));
  }

  told(unit: TellUnit<PlayBeat>): void {
    this.last = unit.scene;
    if (isPlayBeat(unit.scene)) this.lastPlay = this.scene(unit.scene);
  }

  rest(_unit: TellUnit<PlayBeat>, t: PTime, _draft: Plan<DiamondClip>): DiamondClip {
    return this.field(t);
  }

  next(_clip: DiamondClip, t: PTime, _draft: Plan<DiamondClip>): DiamondClip {
    return this.field(t);
  }

  cues(_unit: TellUnit<PlayBeat>, clip: DiamondClip, decisive: PTime): Cue[] {
    const scene = clip.scene;
    if (!scene || !(scene.runs > 0)) return [];
    return [{ at: decisive, until: decisive + 3, kind: { kind: "scored", play: scene.id }, source: { kind: "known", play: scene.id } }];
  }

  handOff(_draft: Plan<DiamondClip>, _k: number): void {}
}

/** Baseball on the director (Phase 0): today's scripts as clips. */
export const DiamondSport: TheaterSport<DiamondClip, RawPlay, DiamondFacts> = {
  sceneContext: () => 0,
  sameContext: (a, b) => a === b,
  sameFacts: sameDiamondFacts,
  sceneReach: 0,
  sceneStart: reachBack(0),

  /** Baseball's director reads the feed's plays as they are. */
  scene(raw: readonly RawPlay[], _json: readonly unknown[], i: number): RawPlay | null {
    return raw[i] ?? null;
  },

  plan(plays, history, facts, chain: PlanChain<DiamondClip>, c, shift, deferFrom, revision, ids: ActorIDs): Plan<DiamondClip> {
    return TheaterPlanner.plan(new DiamondSequencer(plays, history, facts), history, chain, c, shift, deferFrom, revision, ids);
  },

  planSteps(plays, history, facts, chain: PlanChain<DiamondClip>, c, shift, deferFrom, revision, ids: ActorIDs) {
    return TheaterPlanner.planSteps(new DiamondSequencer(plays, history, facts), history, chain, c, shift, deferFrom, revision, ids);
  },

  /** A pitch's horizon: the windup and the stretch before its release; a play's result as its pitch. */
  horizons: { pitch: 4.0, result: 4.0, event: 0 },
};
