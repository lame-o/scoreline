/**
 * One frame of the engine's world through today's basketball frame
 * (BasketballClips.swift `HoopsPainter`): the clip in charge, its time, and
 * every man the chain has at T, posed by the clip that has him (blended from
 * the one he's leaving while he travels) with his stride from the engine's
 * track, in the clip's frame, with the ball where the world has it.
 */
import type { Point } from "../../../../data/mlb/theaterField";
import { HoopsWorld, type HoopsClip } from "../../../../data/theater/basketballClips";
import { BasketballScript } from "../../../../data/theater/basketballScript";
import { mix, over } from "../../../../data/theater/rig";
import type { ActorID } from "../../../../data/theater/theaterEngine";
import type { FrameScratch } from "../../../../data/theater/theaterFrameScratch";
import type { TheaterSpots } from "../../../../data/theater/theaterNames";
import type { Plan, PlanChain } from "../../../../data/theater/theaterPlanChain";
import type { Size } from "../../core/theater/theaterKit";
import { basketRoom, HoopPose, HoopProjection, playerPose, type BasketballWorld, type WorldFigure, type WorldHold } from "./drawBasketball";

/** The placement in charge at p: the latest clip that has begun (its flashes, nets, stamp and banner show; the frame is drawn in its frame). */
export function charge(plan: Plan<HoopsClip>, p: number): number | null {
  for (let i = plan.placements.length - 1; i >= 0; i--) {
    const q = plan.placements[i]!;
    if (q.offset <= p && q.start <= p) return i;
  }
  return plan.placement(p);
}

/** A frame of the world: the clip in charge and its time, and what the frame draws. */
export interface HoopsDrawn {
  readonly clip: HoopsClip;
  readonly placement: number;
  readonly t: number;
  readonly world: BasketballWorld;
}

/** One frame of the engine's world through today's basketball frame (`HoopsPainter.frame`). */
export function hoopsFrame(chain: PlanChain<HoopsClip>, scratch: FrameScratch, size: Size): HoopsDrawn | null {
  if (scratch.plan < 0 || scratch.plan >= chain.plans.length) return null;
  const baked = chain.plans[scratch.plan]!;
  const plan = baked.plan;
  const k = charge(plan, scratch.p);
  if (k == null) return null;
  const placed = plan.placements[k]!;
  const clip = placed.clip;
  const t = clip.local(placed.time(scratch.p));
  const right = clip.right;
  const { frame: camera, yaw } = HoopsWorld.frame(scratch.camera, right);
  const h = new HoopProjection(size, camera, yaw);
  const offenseGroup = (clip.script.side ?? "top") === "top" ? 0 : 1;
  // Who has the ball, and how.
  let holder: ActorID | null = null;
  let hold: WorldHold | null = null;
  let ball: BasketballWorld["ball"] = null;
  if (scratch.ballKind === "clip") {
    const q = plan.placements[scratch.ballPlacement]!;
    const lt = q.clip.local(Math.min(Math.max(q.time(scratch.p), 0), q.clip.length));
    const carrier = q.clip.script.carrier(lt);
    if (carrier && carrier.player < q.cast.length) {
      holder = q.cast[carrier.player]!;
      if (carrier.dribbling) {
        let leg = null as { from: number } | null;
        for (const l of q.clip.script.legs) if (lt >= l.from) leg = l;
        hold = { kind: "dribble", up: BasketballScript.bounce(lt - (leg?.from ?? 0)) };
      } else {
        const player = q.clip.script.players[carrier.player]!;
        const one = player.actions.some((a) => (a.kind === "layup" || a.kind === "hook") && Math.abs(lt - a.at) < 0.4);
        hold = { kind: "hands", oneHanded: one };
      }
      ball = { kind: "held" };
    } else {
      const b = q.clip.ball(lt);
      if (b?.kind === "free") {
        const g = HoopsWorld.local(b.at, right);
        ball = { kind: "free", at: { x: g.x, y: g.y, z: b.at.z }, flying: b.flying };
      }
    }
  } else if (scratch.ballKind === "held") {
    holder = scratch.ballActor;
    hold = { kind: "hands", oneHanded: false };
    ball = { kind: "held" };
  } else if (scratch.ballKind === "free") {
    const g = HoopsWorld.local(scratch.ball, right);
    ball = { kind: "free", at: { x: g.x, y: g.y, z: scratch.ball.z }, flying: true };
  }
  const figures: WorldFigure[] = [];
  for (let n = 0; n < scratch.count; n++) {
    const actor = scratch.actors[n]!;
    const track = baked.tracks[actor.track]!;
    const here = HoopsWorld.local(actor, right);
    const worldHere: Point = { x: actor.x, y: actor.y };
    const unit = h.lens(here).unit;
    const posed = (placement: number, figure: number, time: number) => {
      const c = plan.placements[placement]!.clip;
      const player = c.script.players[figure];
      if (!player) return null;
      return playerPose(c.script, player, figure, c.local(time), here, unit, { track: track.rig, t: scratch.p, at: worldHere });
    };
    const now = posed(actor.placement, actor.figure, actor.clipTime);
    if (!now) continue;
    let body = now[0];
    const heading = now[1];
    if (actor.previousPlacement >= 0 && actor.blend < 1) {
      const from = posed(actor.previousPlacement, actor.previousFigure, actor.previousTime);
      if (from) body = mix(from[0], body, actor.blend);
    }
    const mine = holder === actor.id;
    // Carried across the hand-off: in both hands at the chest.
    if (mine && scratch.ballKind === "held") body = over(body, HoopPose.hold, 1, 1);
    const group = track.figure.group;
    const team = group === 2 ? (track.figure.kind === "staff" ? "staff" : "official") : group === offenseGroup ? "offense" : "defense";
    figures.push({ index: actor.id, team, at: here, body, heading: right ? heading : heading - Math.PI, opacity: actor.opacity, holds: mine ? hold : null });
  }
  const spots = (s: number, at: Size): TheaterSpots => {
    // The clip's own spots at its time s, through the frame's camera now, keyed by the men who play them.
    const g = new HoopProjection(at, camera, yaw);
    const list = clip.script.players.flatMap((player, i) => {
      const id = placed.cast[i];
      if (id == null || !(player.opacity(s) > 0.01)) return [];
      const lens = g.lens(player.position(s));
      return [{ index: id, ground: lens.origin, height: lens.height }];
    });
    const b = clip.script.ball(s);
    return { figures: list, ball: b ? g.at(b) : null, fixtures: [basketRoom(g, -1), basketRoom(g, 1)] };
  };
  return { clip, placement: k, t, world: { camera, yaw, figures, ball, spots } };
}
