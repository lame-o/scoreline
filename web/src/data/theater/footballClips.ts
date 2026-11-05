/**
 * The football theater on the choreography engine, Phase 0
 * (FootballClips.swift; CHOREOGRAPHY §12): today's scripts (a snap's replay,
 * its try, the field between snaps) become clips placed at their plays'
 * anchors, every hand-off a splice from the world as it stands.
 *
 * The world frame is the frame of an offense attacking the screen's right
 * (yaw +30°): x across (its right +), y downfield from its own goal line. A
 * script for an offense attacking the screen's left (yaw −30°) is the field
 * turned half a turn about its center into the world, and the view's yaw
 * there is 150°: a change of possession that reverses direction orbits the
 * camera 120° (football's only possession orbit, §7.2), never a snap.
 *
 * The painter (`GridPainter`) is the drawing's: features/game/football/theater/directedField.ts.
 */
import type { JSONValue } from "../json";
import type { FootballTeams } from "../liveFeeds/football";
import type { Side } from "../models";
import type { CameraFrame } from "../mlb/playCamera";
import type { FieldPoint, Point } from "../mlb/theaterField";
import { footballIdle, FieldFacing, idleScript, parseStoppage, type FootballIdle, type FootballStoppage } from "./footballIdle";
import { opponent, parse, type FootballScene } from "./footballScene";
import { FootballScript, Gridiron, type Rest } from "./footballScript";
import { spot } from "./footballTheater";
import { anchorInput, type AnchorInput } from "./theaterAnchors";
import { ClipFades, ClipPaths, TheaterHandOff, TheaterPlanner, tellUnit, type ActorIDs, type ClipBall, type ClipFigure, type ClipPlacement, type ClipSequencer, type TellUnit, type TheaterClip } from "./theaterClips";
import { sameFields, type TheaterSport } from "./theaterDirector";
import { length2, MotionLimits, v2, vec4, type Band, type Cue, type PTime, type Vec4 } from "./theaterEngine";
import type { MotionPath } from "./theaterMotion";
import type { Plan, PlanChain } from "./theaterPlanChain";
import { mapPlay, type RawPlay, type TimelinePlay, type TimelineSnapshot } from "./theaterSource";

export const GridWorld = {
  center: v2(0, 150),

  /** Whether a script's frame is the world's (its offense attacks the screen's right). */
  right(yaw: number): boolean {
    return yaw >= 0;
  },

  point(p: Point, right: boolean): Point {
    return right ? v2(p.x, p.y) : v2(2 * GridWorld.center.x - p.x, 2 * GridWorld.center.y - p.y);
  },

  local(p: Point, right: boolean): Point {
    return right ? v2(p.x, p.y) : v2(2 * GridWorld.center.x - p.x, 2 * GridWorld.center.y - p.y);
  },

  point3(p: FieldPoint, right: boolean): FieldPoint {
    const g = GridWorld.point(p, right);
    return { x: g.x, y: g.y, z: p.z };
  },

  heading(h: number, right: boolean): number {
    return right ? h : h + Math.PI;
  },

  /** A script's framing at its yaw as the world camera. */
  camera(frame: CameraFrame, yaw: number, right: boolean): Vec4 {
    const vx = frame.x;
    const vy = 2 * frame.y;
    const gx = vx * Math.cos(yaw) - vy * Math.sin(yaw);
    const gy = vx * Math.sin(yaw) + vy * Math.cos(yaw);
    const world = right ? v2(gx, gy) : v2(2 * GridWorld.center.x - gx, 2 * GridWorld.center.y - gy);
    return vec4(world.x, world.y, Math.log(frame.span), right ? yaw : yaw + Math.PI);
  },

  /** The world camera in a script's frame. */
  frame(camera: Vec4, right: boolean): { frame: CameraFrame; yaw: number } {
    const yaw = right ? camera.w : camera.w - Math.PI;
    const c = GridWorld.local(v2(camera.x, camera.y), right);
    const view = Gridiron.view(c, yaw);
    return { frame: { x: view.x, y: view.y / 2, span: Math.exp(camera.z) }, yaw };
  },
};

// MARK: - Clips

export type GridClipKind = "replay" | "idle";

/** The ball's contacts a man keeps exactly where they were; a tackle or a strip only if he's credited with it. */
const BALL_CONTACTS = new Set(["catchHigh", "catchChest", "throwBall", "handoff", "kick", "scoop"]);
const CREDITED_CONTACTS = new Set(["tackle", "strip"]);

/** His motion band: the officials and staff, the men in the trenches, everyone else. */
const bandName = (team: string, role: string): string => (team === "official" || team === "staff" ? "official" : role === "line" || role === "front" ? "line" : "skill");

/** One of today's football scripts as the engine places it: a snap's replay (or its try), or the field between snaps. */
export class GridClip implements TheaterClip {
  readonly kind: GridClipKind;
  readonly right: boolean;
  readonly figures: readonly ClipFigure[];
  readonly length: number;
  readonly still: number;
  readonly decisive: number | null;
  readonly essential: number;
  readonly paths: readonly (MotionPath | null)[];
  /** The men who still can't make it, faded through (ClipFades). */
  readonly fades: ClipFades;

  constructor(
    readonly script: FootballScript,
    readonly scene: FootballScene | null,
    readonly idle: FootballIdle | null,
    readonly offense: Side,
    readonly stoppage: FootballStoppage | null = null,
  ) {
    this.kind = idle == null ? "replay" : "idle";
    this.right = GridWorld.right(script.yaw);
    this.figures = script.players.map((p, i) => {
      const group = p.team === "offense" ? (offense === "top" ? 0 : 1) : p.team === "defense" ? (offense === "top" ? 1 : 0) : 2;
      const credit = script.credits.get(i);
      return { group, kind: p.key ?? p.role, athlete: credit ? (credit.id ?? credit.name ?? null) : null, band: bandName(p.team, p.role), height: 8.5 };
    });
    const bands: Band[] = script.players.map((p) => MotionLimits.football.band(bandName(p.team, p.role)));
    // The script's clock is the clip's: each man solved on his own, the contacts he's credited with exactly where
    // they were. A tackle nobody credits him with is a place he was running to, no more.
    const loop = script.loop;
    const seams = loop ? [loop.start, loop.start + loop.period] : [];
    const paths = script.players.map((p, i) => {
      const credited = script.credits.has(i);
      const contacts = p.actions.filter((a) => BALL_CONTACTS.has(a.kind) || (credited && CREDITED_CONTACTS.has(a.kind))).map((a) => a.at);
      return ClipPaths.resynthesized(p.moves, contacts, bands[i]!, { lower: 0, upper: Math.max(script.duration, 0) }, (t) => p.position(t), true, seams);
    });
    this.paths = paths;
    this.length = idle == null ? script.duration : Infinity;
    // Whoever still can't make a replay's run fades through it (declared, counted).
    this.fades = idle != null ? ClipFades.none : ClipFades.make(paths.length, script.duration, bands, (i, t) => {
      const path = paths[i];
      return path ? length2(path.velocity(t)) : 0;
    });
    this.still = idle == null ? script.leadIn : 0;
    this.decisive = idle == null ? GridClip.decisiveOf(script) : null;
    this.essential = idle == null ? Math.min(this.length, (this.decisive ?? 0) + 1.2) : 0;
  }

  /** The ball dead: the score, else the hit or the catch that ends it, else the incompletion's landing. */
  static decisiveOf(s: FootballScript): number | null {
    if (s.score != null) return s.score;
    const last = (beat: string): number | null => {
      for (let i = s.flashes.length - 1; i >= 0; i--) if (s.flashes[i]!.beat === beat) return s.flashes[i]!.at;
      return null;
    };
    const hit = last("hit");
    if (hit != null) return hit;
    const caught = last("catchBall");
    if (caught != null) return caught;
    const f = s.flights[s.flights.length - 1];
    if (f) return f.end;
    return Number.isFinite(s.stamp) ? s.stamp - 0.3 : null;
  }

  /** An idle loops; a replay holds its end. */
  local(t: number): number {
    const held = Math.min(Math.max(t, 0), this.script.duration);
    if (this.kind !== "idle") return held;
    const loop = this.script.loop;
    if (!loop || !(loop.period > 0) || !(t > loop.start + loop.period)) return held;
    return loop.start + ((t - loop.start) % loop.period);
  }

  get ambient(): boolean {
    return this.kind === "idle";
  }

  position(figure: number, t: number): Point {
    const path = this.paths[figure];
    if (path) return GridWorld.point(path.position(this.local(t)), this.right);
    return GridWorld.point(this.script.players[figure]!.position(this.local(t)), this.right);
  }

  heading(figure: number, t: number): number {
    const track = this.script.rig[figure];
    const h = track ? track.motion(this.local(t)).heading : 0;
    return GridWorld.heading(h, this.right);
  }

  opacity(figure: number, t: number): number {
    return this.script.players[figure]!.opacity(this.local(t)) * this.fades.opacity(figure, t);
  }

  ball(t: number): ClipBall | null {
    const lt = this.local(t);
    const carrier = this.script.carrier(lt);
    if (carrier) return { kind: "held", figure: carrier.player };
    const b = this.script.ball(lt);
    if (!b) return null;
    return { kind: "free", at: GridWorld.point3(b, this.right), flying: this.script.flight(lt) != null };
  }

  camera(t: number): Vec4 {
    const lt = this.local(t);
    return GridWorld.camera(this.script.camera.frame(lt), this.script.yawAt(lt), this.right);
  }

  moving(t: number): boolean {
    if (!(t >= 0)) return false;
    if (this.kind === "replay") return t <= this.length;
    if (!(t < this.script.duration) && this.script.loop == null) return false;
    return this.script.moving(this.local(t));
  }
}

// MARK: - The plan (Phase 0)

/** What the football planner needs to know about the game (the page's teams, the viewer's turn of the field). */
export interface GridFacts {
  readonly topIsHome: boolean;
  readonly flipped: boolean;
  readonly topID: string | null;
  readonly bottomID: string | null;
  readonly homeAbbreviation: string;
  readonly awayAbbreviation: string;
  readonly homeName: string;
  readonly awayName: string;
}

/** The page's teams (FootballFeed's), as the planner's facts (`GridFacts(teams)`). */
export const gridFacts = (teams: FootballTeams, flipped = false): GridFacts => ({
  topIsHome: teams.topIsHome,
  flipped,
  topID: teams.topID,
  bottomID: teams.bottomID,
  homeAbbreviation: teams.homeAbbreviation,
  awayAbbreviation: teams.awayAbbreviation,
  homeName: teams.homeName ?? "",
  awayName: teams.awayName ?? "",
});

/** The facts' teams, as the parsers read them (`GridFacts.teams`). */
export const gridTeams = (f: GridFacts): FootballTeams => ({
  topIsHome: f.topIsHome,
  topID: f.topID,
  bottomID: f.bottomID,
  homeAbbreviation: f.homeAbbreviation,
  awayAbbreviation: f.awayAbbreviation,
  homeName: f.homeName,
  awayName: f.awayName,
});

/** A football entry as the planner reads it: a snap (or kick), or a stoppage. */
export type GridPlay = { readonly kind: "snap"; readonly scene: FootballScene } | { readonly kind: "stoppage"; readonly stoppage: FootballStoppage };

export const gridPlayID = (p: GridPlay): string => (p.kind === "snap" ? p.scene.id : p.stoppage.id);

export const GridPlanner = {
  /** The timeline's entries as snaps and stoppages, each snap spotted on its hash from the one before (FootballFeed's rule). */
  plays(snapshot: TimelineSnapshot<RawPlay>, teams: FootballTeams): TimelinePlay<GridPlay>[] {
    const out: TimelinePlay<GridPlay>[] = [];
    let last: FootballScene | null = null;
    for (const p of snapshot.plays) {
      const scene = parse(p.play.json, teams);
      if (scene) {
        if (last) scene.hash = spot([scene], last)[0]?.hash ?? scene.hash;
        last = scene;
        out.push(mapPlay(p, { kind: "snap", scene }));
      } else {
        const stop = parseStoppage(p.play.json, teams);
        if (stop) out.push(mapPlay(p, { kind: "stoppage", stoppage: stop }));
      }
    }
    return out;
  },

  /** The least time between two snaps' dead balls (a huddle-less snap is ~15 s; 8 s is the physical floor). */
  inputs(plays: readonly TimelinePlay<GridPlay>[]): AnchorInput[] {
    return plays.map((p) => {
      const snap = p.play.kind === "snap";
      let weight = snap ? 1.0 : 0.25;
      if (p.estimated) weight *= 0.25;
      return anchorInput({
        id: p.id,
        period: p.period,
        eventTime: p.eventTime,
        bounds: p.eventBounds,
        elapsed: p.clock.elapsed,
        live: snap,
        stopsClock: p.kind.stopsClock,
        weight,
        gapAfter: snap ? 8 : 1,
        restartAfter: 1,
      });
    });
  },
};

/**
 * Football's Phase 0 running order: each snap its replay (a touchdown's try
 * after it), the field between snaps from where the snap left it (never the
 * live situation: the field follows the told plays), the stoppages ESPN
 * posts.
 */
export class GridSequencer implements ClipSequencer<GridClip, GridPlay> {
  /** The last snap told, the stoppage after it (whether a score's kickoff is next follows from the snap). */
  last: FootballScene | null = null;
  stoppage: FootballStoppage | null = null;
  readonly limits = MotionLimits.football;
  readonly yawRule = null;
  private inputs: AnchorInput[] | null = null;

  constructor(
    readonly plays: readonly TimelinePlay<GridPlay>[],
    readonly history: ReadonlySet<string>,
    readonly facts: GridFacts,
  ) {}

  get anchorInputs(): readonly AnchorInput[] {
    this.inputs ??= GridPlanner.inputs(this.plays);
    return this.inputs;
  }

  units(handled: ReadonlySet<string>): TellUnit<GridPlay>[] {
    const out: TellUnit<GridPlay>[] = [];
    for (const p of this.plays) {
      if (handled.has(p.id) || this.history.has(p.id)) continue;
      const play = p.play;
      if (play.kind === "snap") {
        out.push(tellUnit(play.scene.id, play, { fromWorld: false }));
        const attempt = play.scene.conversion;
        if (attempt && !handled.has(attempt.id)) out.push(tellUnit(attempt.id, { kind: "snap", scene: attempt } as GridPlay, { fromWorld: false }));
      } else {
        out.push(tellUnit(p.id, play, { admin: true, fromWorld: true }));
      }
    }
    return out;
  }

  /** The field the next snap lines up on, in its offense's yards, from where the last one ended. */
  spot(scene: FootballScene | null): { rest: Rest; offense: Side } {
    const offense = scene?.offense;
    if (!scene || !offense) return { rest: { yard: 25, gain: 35 }, offense: "top" };
    const next = scene.flips ? opponent(offense) : offense;
    const yard = scene.flips ? 100 - scene.to : scene.to;
    const gain = scene.flips ? null : scene.gainAfter;
    return { rest: { yard: Math.min(Math.max(yard, 1), 99), gain }, offense: next };
  }

  /** The field between snaps after the last snap told and the stoppage after it (`stoppage`: this one's, else the sequencer's). */
  idle(_t: PTime, settled = false, stoppage: FootballStoppage | null = this.stoppage): GridClip {
    const last = this.last;
    const { rest, offense } = this.spot(last);
    const kickoff = last?.scoring != null && last.conversion == null;
    const idle = footballIdle({ play: last, stoppage, rest, offense, down: last?.after ?? null, kickoff, flipped: this.facts.flipped, settled });
    return new GridClip(idleScript(idle), null, idle, idle.offense, stoppage);
  }

  opening(t: PTime): GridClip {
    for (const p of this.plays) {
      if (!this.history.has(p.id)) continue;
      this.tell(p.play);
    }
    return this.idle(t, this.stoppage != null);
  }

  resume(kept: readonly ClipPlacement<GridClip>[]): void {
    // The running order as the kept placements left it: the last snap told and any stoppage after it.
    for (const p of this.plays) {
      if (!(kept.some((k) => k.covers.includes(p.id)) || this.history.has(p.id))) continue;
      this.tell(p.play);
    }
  }

  clip(unit: TellUnit<GridPlay>, t: PTime, _draft: Plan<GridClip>): GridClip {
    const play = unit.scene;
    if (play.kind === "snap") {
      const scene = play.scene;
      const yaw = FieldFacing.yaw(scene.offense, scene.period, this.facts.flipped);
      return new GridClip(FootballScript.play(scene, yaw), scene, null, scene.offense ?? "top");
    }
    // The stoppage's field, from the running order as it stands (a copy: told() moves it on): settled when a break was already on.
    return this.idle(t, this.stoppage != null, play.stoppage);
  }

  told(unit: TellUnit<GridPlay>): void {
    this.tell(unit.scene);
  }

  private tell(play: GridPlay): void {
    if (play.kind === "snap") {
      this.last = play.scene;
      this.stoppage = null;
    } else {
      this.stoppage = play.stoppage;
    }
  }

  rest(_unit: TellUnit<GridPlay>, t: PTime, _draft: Plan<GridClip>): GridClip {
    return this.idle(t);
  }

  next(_clip: GridClip, t: PTime, _draft: Plan<GridClip>): GridClip {
    return this.idle(t);
  }

  cues(unit: TellUnit<GridPlay>, _clip: GridClip, decisive: PTime): Cue[] {
    const play = unit.scene;
    if (play.kind !== "snap" || play.scene.scoring == null) return [];
    const id = play.scene.id;
    return [{ at: decisive, until: decisive + 3, kind: { kind: "scored", play: id }, source: { kind: "known", play: id } }];
  }

  handOff(draft: Plan<GridClip>, k: number): void {
    TheaterHandOff.ball(draft, k, 50, 3.4);
  }
}

/** Football on the director (Phase 0): today's scripts as clips. */
export const GridSport: TheaterSport<GridClip, GridPlay, GridFacts> = {
  sceneContext: () => 0,
  sameContext: (a, b) => a === b,
  sameFacts: (a, b) => sameFields(a, b),
  sceneReach: 1,
  sceneStart: (first: number) => Math.max(first - 1, 0),

  /** The snaps up to the watermark, each spotted after the one before (`GridPlanner.plays`), and the stoppages. */
  scene(_raw: readonly RawPlay[], json: readonly JSONValue[], i: number, pending: boolean, facts: GridFacts, _context: number, prior: readonly (GridPlay | null)[]): GridPlay | null {
    if (pending) return null;
    const teams = gridTeams(facts);
    const scene = parse(json[i], teams);
    if (scene) {
      let last: FootballScene | null = null;
      for (let k = prior.length - 1; k >= 0; k--) {
        const p = prior[k];
        if (p?.kind === "snap") {
          last = p.scene;
          break;
        }
      }
      if (last) scene.hash = spot([scene], last)[0]?.hash ?? scene.hash;
      return { kind: "snap", scene };
    }
    const stop = parseStoppage(json[i], teams);
    return stop ? { kind: "stoppage", stoppage: stop } : null;
  },

  plan(plays, history, facts, chain: PlanChain<GridClip>, c, shift, deferFrom, revision, ids: ActorIDs): Plan<GridClip> {
    return TheaterPlanner.plan(new GridSequencer(plays, history, facts), history, chain, c, shift, deferFrom, revision, ids);
  },

  planSteps(plays, history, facts, chain: PlanChain<GridClip>, c, shift, deferFrom, revision, ids: ActorIDs) {
    return TheaterPlanner.planSteps(new GridSequencer(plays, history, facts), history, chain, c, shift, deferFrom, revision, ids);
  },

  /** The snap's dead ball ~6 s (a line-up and the play); a kick's longer; the stoppages none (they attach late). */
  horizons: { snap: 6, kick: 8, penalty: 6 },
};
