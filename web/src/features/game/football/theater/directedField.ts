/**
 * One frame of the engine's world through today's football frame
 * (FootballClips.swift `GridPainter`): the clip in charge, its time, and
 * every man the chain has at T, posed by the clip that has him (blended from
 * the one he's leaving while he travels) with his stride from the engine's
 * track, in the clip's frame, with the ball where the world has it: in the
 * hands of the man who has it (tucked, or cocked to throw, as the clip has
 * it), or free where the clip or the hand-off's pass puts it.
 */
import type { Point } from "../../../../data/mlb/theaterField";
import { GridWorld, type GridClip } from "../../../../data/theater/footballClips";
import { mix, Rig } from "../../../../data/theater/rig";
import type { ActorID } from "../../../../data/theater/theaterEngine";
import type { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import type { TheaterSpots } from "../../../../data/theater/theaterNames";
import type { Plan, PlanChain } from "../../../../data/theater/theaterPlanChain";
import { RigLens } from "../../core/theater/rigFigure";
import type { Size } from "../../core/theater/theaterKit";
import { cocked, GridProjection, hitFigures, playerPose, type FootballWorld, type WorldFigure } from "./drawFootball";

/** The placement in charge at p: the latest clip that has begun (its lines, flags, flashes, stamp and banner show; the frame is drawn in its frame). */
export function charge(plan: Plan<GridClip>, p: number): number | null {
  for (let i = plan.placements.length - 1; i >= 0; i--) {
    const q = plan.placements[i]!;
    if (q.offset <= p && q.start <= p) return i;
  }
  return plan.placement(p);
}

/** A frame of the world: the clip in charge and its time, and what the frame draws. */
export interface GridDrawn {
  readonly clip: GridClip;
  readonly placement: number;
  readonly t: number;
  readonly world: FootballWorld;
}

/** One frame of the engine's world through today's football frame (`GridPainter.frame`). */
export function gridFrame(chain: PlanChain<GridClip>, scratch: FrameScratch, size: Size): GridDrawn | null {
  if (scratch.plan < 0 || scratch.plan >= chain.plans.length) return null;
  const baked = chain.plans[scratch.plan]!;
  const plan = baked.plan;
  const k = charge(plan, scratch.p);
  if (k == null) return null;
  const placed = plan.placements[k]!;
  const clip = placed.clip;
  const t = clip.local(placed.time(scratch.p));
  const right = clip.right;
  const turned = !right;
  const { frame: camera, yaw } = GridWorld.frame(scratch.camera, right);
  const f = new GridProjection(size, camera, yaw);
  const offenseGroup = clip.offense === "top" ? 0 : 1;
  // Who has the ball, and where on him.
  let holder: ActorID | null = null;
  let tucked = 0;
  let cock = 0;
  let ball: FootballWorld["ball"] = null;
  if (scratch.ballKind === "clip") {
    const q = plan.placements[scratch.ballPlacement]!;
    const clipTime = q.time(scratch.p);
    const lt = q.clip.local(clipTime);
    const carrier = q.clip.script.carrier(lt);
    if (carrier && carrier.player < q.cast.length) {
      holder = q.cast[carrier.player]!;
      const player = q.clip.script.players[carrier.player]!;
      cock = cocked(player, lt, q.clip.script.pace);
      let speed = 0;
      for (let n = 0; n < scratch.count; n++) if (scratch.actors[n]!.id === holder) speed = scratch.actors[n]!.motion.speed;
      tucked = player.role === "quarterback" ? Rig.smooth((speed - 1.5) / 1) : 1;
      ball = { kind: "held" };
    } else {
      const b = q.clip.ball(clipTime);
      if (b?.kind === "free") {
        const g = GridWorld.local(b.at, right);
        ball = { kind: "free", at: { x: g.x, y: g.y, z: b.at.z }, flying: b.flying };
      }
    }
  } else if (scratch.ballKind === "held") {
    holder = scratch.ballActor;
    ball = { kind: "held" };
  } else if (scratch.ballKind === "free") {
    const g = GridWorld.local(scratch.ball, right);
    ball = { kind: "free", at: { x: g.x, y: g.y, z: scratch.ball.z }, flying: true };
  }
  const figures: WorldFigure[] = [];
  for (let n = 0; n < scratch.count; n++) {
    const actor = scratch.actors[n]!;
    const track = baked.tracks[actor.track]!;
    const here = GridWorld.local(actor, right);
    const worldHere: Point = { x: actor.x, y: actor.y };
    const unit = RigLens.grid(f, here).unit;
    const posed = (placement: number, figure: number, time: number) => {
      const c = plan.placements[placement]!.clip;
      const player = c.script.players[figure];
      if (!player) return null;
      const lt = c.local(time);
      const [body, heading] = playerPose(c.script, player, figure, lt, here, unit, { track: track.rig, t: scratch.p, at: worldHere });
      const held = player.hold(lt)?.kind;
      return { body, heading, down: held === "down" || held === "knocked" };
    };
    const now = posed(actor.placement, actor.figure, actor.clipTime);
    if (!now) continue;
    let body = now.body;
    if (actor.previousPlacement >= 0 && actor.blend < 1) {
      const from = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime);
      if (from) body = mix(from.body, body, actor.blend);
    }
    const group = track.figure.group;
    const team = group === 2 ? plan.placements[actor.placement]!.clip.script.players[actor.figure]!.team : group === offenseGroup ? "offense" : "defense";
    const mine = holder === actor.id;
    figures.push({
      index: actor.id,
      team,
      at: here,
      body,
      heading: turned ? now.heading - Math.PI : now.heading,
      opacity: actor.opacity,
      holds: mine,
      tucked: mine ? tucked : 0,
      cocked: mine ? cock : 0,
      down: now.down,
    });
  }
  const spots = (s: number, at: Size): TheaterSpots => {
    // The clip's own spots at its time s, through the frame's camera now, keyed by the men who play them.
    const g = new GridProjection(at, camera, yaw);
    const list = hitFigures(g, clip.script, s).flatMap((h) => {
      const id = placed.cast[h.index];
      return id == null ? [] : [{ ...h, index: id }];
    });
    const b = clip.script.ball(s);
    return { figures: list, ball: b ? g.at(b) : null };
  };
  return { clip, placement: k, t, world: { camera, yaw, figures, ball, spots } };
}
