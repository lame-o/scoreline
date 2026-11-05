/**
 * One frame of the engine's world through today's soccer frame
 * (SoccerClips.swift `PitchPainter`): the clip in charge and its time; each
 * of its figures where the engine has his man, posed by it (blended from the
 * clip he's leaving while he travels) with his stride from the engine's
 * track; everyone else (on the way to another clip, or leaving) in his own
 * kit, posed by his own clip; the ball. The world is the pitch as drawn, so
 * nothing turns.
 */
import type { CameraFrame } from "../../../../data/mlb/playCamera";
import type { Side } from "../../../../data/models";
import { mix } from "../../../../data/theater/rig";
import type { PitchClip } from "../../../../data/theater/soccerClips";
import { PitchFrame, type Team } from "../../../../data/theater/soccerScript";
import { PitchProjection } from "../../../../data/theater/soccerTheater";
import type { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import type { HitFigure, TheaterSpots } from "../../../../data/theater/theaterNames";
import type { Plan, PlanChain } from "../../../../data/theater/theaterPlanChain";
import { RigLens } from "../../core/theater/rigFigure";
import type { Size } from "../../core/theater/theaterKit";
import { actorPose, type SoccerWorld, type SoccerWorldExtra, type SoccerWorldFigure } from "./drawSoccer";

/** The placement in charge at p: the latest clip that has begun (its trail, impacts, banners and stamp show). */
export function charge(plan: Plan<PitchClip>, p: number): number | null {
  for (let i = plan.placements.length - 1; i >= 0; i--) {
    const q = plan.placements[i]!;
    if (q.offset <= p && q.start <= p) return i;
  }
  return plan.placement(p);
}

/** A frame of the world: the clip in charge and its time, and what the frame draws. */
export interface PitchDrawn {
  readonly clip: PitchClip;
  readonly placement: number;
  readonly t: number;
  readonly world: SoccerWorld;
}

/** One frame of the engine's world through today's soccer frame (`PitchPainter.frame`). */
export function pitchFrame(chain: PlanChain<PitchClip>, scratch: FrameScratch, size: Size): PitchDrawn | null {
  if (scratch.plan < 0 || scratch.plan >= chain.plans.length) return null;
  const baked = chain.plans[scratch.plan]!;
  const plan = baked.plan;
  const k = charge(plan, scratch.p);
  if (k == null) return null;
  const placed = plan.placements[k]!;
  const clip = placed.clip;
  const t = clip.local(placed.time(scratch.p));
  const camera: CameraFrame = { x: scratch.camera.x, y: scratch.camera.y, span: Math.exp(scratch.camera.z) };
  const f = new PitchProjection(size, new PitchFrame(camera));
  const figures = new Map<number, SoccerWorldFigure>();
  const extras: SoccerWorldExtra[] = [];
  for (let n = 0; n < scratch.count; n++) {
    const actor = scratch.actors[n]!;
    const track = baked.tracks[actor.track]!;
    const here = { x: actor.x, y: actor.y };
    const unit = RigLens.pitch(f, here).unit;
    const posed = (placement: number, figure: number, time: number) => {
      const c = plan.placements[placement]!.clip;
      const a = c.script.actors[figure];
      if (!a) return null;
      return actorPose(c.script, a, figure, c.local(time), here, unit, { track: track.rig, t: scratch.p, at: here });
    };
    const now = posed(actor.placement, actor.figure, actor.clipTime);
    if (!now) continue;
    let body = now[0];
    if (actor.previousPlacement >= 0 && actor.blend < 1) {
      const from = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime);
      if (from) body = mix(from[0], body, actor.blend);
    }
    if (actor.placement === k) {
      figures.set(actor.figure, { index: actor.id, at: here, body, heading: now[1], opacity: actor.opacity });
    } else {
      const own = plan.placements[actor.placement]!.clip;
      const team = own.script.actors[actor.figure]!.team;
      // His kit as the clip in charge dresses its teams: the same side, whichever is attacking now.
      const side: Side | null = team === "attacking" ? own.attacking : team === "defending" ? (own.attacking === "top" ? "bottom" : "top") : null;
      const drawn: Team = side != null ? (side === clip.attacking ? "attacking" : "defending") : team;
      extras.push({ index: actor.id, team: drawn, at: here, body, heading: now[1], opacity: actor.opacity });
    }
  }
  let ball: SoccerWorld["ball"] = null;
  if (scratch.ballKind === "clip") {
    const q = plan.placements[scratch.ballPlacement]!;
    const b = q.clip.ball(q.time(scratch.p));
    if (b?.kind === "free") ball = { at: { x: b.at.x, y: b.at.y, z: b.at.z }, flying: b.flying };
  } else if (scratch.ballKind === "free") {
    ball = { at: { x: scratch.ball.x, y: scratch.ball.y, z: scratch.ball.z }, flying: true };
  }
  const spots = (s: number, at: Size): TheaterSpots => {
    // The clip's own spots at its time s, through the frame's camera now, keyed by the men who play them.
    const g = new PitchProjection(at, new PitchFrame(camera));
    const list: HitFigure[] = clip.script.actors.flatMap((actor, i) => {
      const id = placed.cast[i];
      if (id == null || !(actor.opacity(s) > 0.01)) return [];
      const lens = RigLens.pitch(g, actor.position(s));
      return [{ index: id, ground: lens.origin, height: lens.height }];
    });
    const b = clip.script.ballOpacity(s) > 0.01 ? clip.script.ball(s) : null;
    return { figures: list, ball: b ? g.point(b) : null };
  };
  return { clip, placement: k, t, world: { camera, figures, extras, ball, spots } };
}
