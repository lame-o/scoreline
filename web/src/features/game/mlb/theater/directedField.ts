/**
 * One frame of the engine's world through today's baseball frame
 * (BaseballClips.swift `DiamondPainter`): the clip in charge and its time;
 * each of its figures where the engine has his man, posed by it (blended
 * from the clip he's leaving while he travels) with his stride from the
 * engine's track; everyone else in his own kit; the ball where the world has
 * it. The ballpark is the world frame: nothing turns.
 */
import type { DiamondClip } from "../../../../data/mlb/baseballClips";
import type { Team } from "../../../../data/mlb/playScript";
import type { FieldPoint, Point } from "../../../../data/mlb/theaterField";
import type { Side } from "../../../../data/models";
import { mix } from "../../../../data/theater/rig";
import type { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import type { Plan, PlanChain } from "../../../../data/theater/theaterPlanChain";
import { RigLens } from "../../core/theater/rigFigure";
import { FieldProjection, pose, type PlayWorld, type PlayWorldExtra, type PlayWorldFigure, type Size } from "./drawTheater";

/** The placement in charge at p: the latest clip that has begun (its zone, trace, flashes, label, stamp and banner show). */
export function charge(plan: Plan<DiamondClip>, p: number): number | null {
  for (let i = plan.placements.length - 1; i >= 0; i--) {
    const q = plan.placements[i]!;
    if (q.offset <= p && q.start <= p) return i;
  }
  return plan.placement(p);
}

/** A frame of the world: the clip in charge, its placement and time, and what the frame draws. */
export interface DiamondDrawn {
  readonly clip: DiamondClip;
  readonly placement: number;
  readonly t: number;
  readonly world: PlayWorld;
}

/** One frame of the engine's world through today's baseball frame (`DiamondPainter.frame`). */
export function diamondFrame(chain: PlanChain<DiamondClip>, scratch: FrameScratch, size: Size): DiamondDrawn | null {
  if (scratch.plan < 0 || scratch.plan >= chain.plans.length) return null;
  const baked = chain.plans[scratch.plan]!;
  const plan = baked.plan;
  const k = charge(plan, scratch.p);
  if (k == null) return null;
  const placed = plan.placements[k]!;
  const clip = placed.clip;
  const t = clip.local(placed.time(scratch.p));
  const camera = { x: scratch.camera.x, y: scratch.camera.y, span: Math.exp(scratch.camera.z) };
  const f = new FieldProjection(size, camera);
  const figures = new Map<number, PlayWorldFigure>();
  const extras: PlayWorldExtra[] = [];
  for (let n = 0; n < scratch.count; n++) {
    const actor = scratch.actors[n]!;
    const track = baked.tracks[actor.track]!;
    const here: Point = { x: actor.x, y: actor.y };
    const unit = RigLens.field(f, here).unit;
    const posed = (placement: number, figure: number, time: number) => {
      const c = plan.placements[placement]!.clip;
      const a = c.script.actors[figure];
      if (!a) return null;
      return pose(c.script, c.local(time), a, figure, here, unit, { track: track.rig, t: scratch.p, at: here });
    };
    const now = posed(actor.placement, actor.figure, actor.clipTime);
    if (!now) continue;
    let body = now[0];
    if (actor.previousPlacement >= 0 && actor.blend < 1) {
      const from = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime);
      if (from) body = mix(from[0], body, actor.blend);
    }
    if (actor.placement === k) {
      figures.set(actor.figure, { at: here, body, heading: now[1], opacity: actor.opacity });
    } else {
      const own = plan.placements[actor.placement]!.clip;
      const team = own.script.actors[actor.figure]!.team;
      // His kit as the clip in charge dresses its teams: the same side, batting or fielding now.
      const side: Side | null = team === "batting" ? own.batting : team === "fielding" ? (own.batting === "top" ? "bottom" : "top") : null;
      const drawn: Team = side != null ? (side === clip.batting ? "batting" : "fielding") : team;
      extras.push({ index: actor.id, team: drawn, at: here, body, heading: now[1], opacity: actor.opacity });
    }
  }
  let ball: FieldPoint | null = null;
  if (scratch.ballKind === "clip") {
    const q = plan.placements[scratch.ballPlacement]!;
    const b = q.clip.ball(q.time(scratch.p));
    if (b?.kind === "free") ball = { x: b.at.x, y: b.at.y, z: b.at.z };
  } else if (scratch.ballKind === "free") {
    ball = { x: scratch.ball.x, y: scratch.ball.y, z: scratch.ball.z };
  }
  return { clip, placement: k, t, world: { camera, figures, extras, ball } };
}
