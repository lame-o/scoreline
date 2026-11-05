/**
 * A soccer moment replayed under its row (ReplayWell.swift's `.soccer`
 * take and frame): the moment turned round for the half (or the viewer's
 * turn of the pitch), scripted with both elevens as the live theater
 * scripts it (SoccerTheater.tsx). The pitch, the build-up and the strike,
 * the stamp, the tag (what the moment is, until its headline and stamp say
 * it), the celebration (its moment as the live lane offered it) and the
 * names, the men in the moment as they stood with each change made by its
 * minute. Its control sits in the corner away from the stamp. Its own
 * chunk, loaded with the well.
 */
import { cueFor, presetFor } from "../../../../data/celebrations";
import type { JSONValue } from "../../../../data/json";
import { dress } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { replayKits, replayTeams, type ReplayScene } from "../../../../data/replays";
import { PitchFacing, SoccerStatus, turnedScene, type SoccerNames } from "../../../../data/theater/soccerIdle";
import { goalOf, lineupsOn, readLineups, scored, type Lineups, type SoccerScene } from "../../../../data/theater/soccerScene";
import { SoccerScript } from "../../../../data/theater/soccerScript";
import { GoalCelebration, PitchProjection, soccerCast, soccerKey } from "../../../../data/theater/soccerTheater";
import { theaterLabels, type HitFigure, type TheaterCast } from "../../../../data/theater/theaterNames";
import { NO_STATUS, perTake, tagColor, type ReplaySport } from "../../core/replay/replayDrawing";
import { RigLens } from "../../core/theater/rigFigure";
import { accentOf, drawBursts, teamPalette, TheaterType } from "../../core/theater/theaterKit";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { drawPitch, drawSoccerFrame, layoutLabels, soccerProjection, type SoccerTeams } from "./drawSoccer";

/** One take of a soccer replay: the moment turned round for the half (or the viewer's turn), and its script. */
export interface SoccerTake {
  readonly scene: SoccerScene;
  readonly script: SoccerScript;
}

/** The squads, read once per roster pair: the theater's lineups. */
const read = new WeakMap<object, Lineups>();
export function replayLineups(rosters: Readonly<Partial<Record<Side, JSONValue>>>): Lineups {
  let lineups = read.get(rosters);
  if (!lineups) {
    lineups = readLineups(rosters);
    read.set(rosters, lineups);
  }
  return lineups;
}

/**
 * A replay's take, scripted as the live theater scripts it, turned round for
 * the half and the game's turn of the pitch. (ReplayTake.takes; pure; tested)
 */
export function soccerTakes(scene: ReplayScene, flipped: boolean, lineups: Lineups): SoccerTake[] {
  if (scene.kind !== "soccer") return [];
  const moment = scene.scene;
  const drawn = PitchFacing.homeAttacksRight(moment.period, flipped) ? moment : turnedScene(moment);
  return [{ scene: drawn, script: SoccerScript.build(drawn, lineups) }];
}

export const soccerReplay: ReplaySport<SoccerTake> = {
  takes: (scene, flipped, context) => soccerTakes(scene, flipped, replayLineups(context.rosters)),

  drawing(takes, replay, context, look) {
    const { scheme, flipped, level, reduceMotion } = look;
    const kits = replayKits(context);
    const dressed = dress(kits, scheme);
    const ink = theaterInk(scheme);
    const teams = (side: Side): SoccerTeams => (side === "top" ? { attacking: dressed.top, defending: dressed.bottom } : { attacking: dressed.bottom, defending: dressed.top });
    const full = replayTeams(context);
    const names: SoccerNames = { top: full.top, bottom: full.bottom, topColor: tagColor(kits.top.color), bottomColor: tagColor(kits.bottom.color) };
    const tagLabels = theaterLabels(kits, scheme, full);
    const lineups = replayLineups(context.rosters);
    const casts = new Map<number, TheaterCast>();
    const castOf = (i: number): TheaterCast => {
      let cast = casts.get(i);
      if (!cast) {
        const { scene, script } = takes[i]!;
        cast = soccerCast(script, scene.side, lineupsOn(lineups, scene.clock), context.people, scene.shooterCredit?.athlete ?? null, `replay|${soccerKey(scene)}|${flipped}`);
        casts.set(i, cast);
      }
      return cast;
    };
    const labelsFor = perTake((i, ctx, size, pt) => {
      const { scene, script } = takes[i]!;
      return layoutLabels(ctx, scene, script, teams(scene.side), ink, size, pt);
    });
    const first = takes[0];
    // The heartbeat's corner in the live theater, away from the stamp: the control's.
    const corner = first?.script.cornerRight ? "leading" : "trailing";
    const status = (i: number, t: number) => {
      const take = takes[i];
      if (!take) return NO_STATUS;
      // The headline and the stamp say it for themselves.
      const banner = take.script.banners.some((b) => t >= b.at - 0.3 && t < b.until + 0.3);
      return banner || t >= take.script.stamp ? NO_STATUS : SoccerStatus.replay(take.scene, names);
    };
    return {
      lengths: takes.map((t) => t.script.duration),
      ended: () => Infinity,
      corner,
      status,
      paint(ctx, size, pt, i, t, elapsed, bursts, tagged) {
        const take = takes[i];
        if (!take) return;
        const { scene, script } = take;
        const f = soccerProjection(size, script, t);
        /** Each player on screen at t through the camera, for the hit test: his spot and the lens there, no posing. */
        const hits = (): HitFigure[] =>
          script.actors.flatMap((actor, index) => {
            if (!(actor.opacity(t) > 0.01)) return [];
            const lens = RigLens.pitch(f, actor.position(t));
            return [{ index, ground: lens.origin, height: lens.height }];
          });
        const tags = tagged.frame(castOf(i), tagLabels, { status: status(i, t).tag, flip: false, heartbeat: corner }, hits);
        const side = teams(scene.side);
        drawPitch(ctx, f, ink);
        drawSoccerFrame(ctx, f, { scene, script, t, teams: side, ink, labels: labelsFor(i, ctx, size, pt), tags });
        if (bursts.length > 0) {
          const palette = teamPalette(accentOf(side.attacking, ink), ink);
          drawBursts(ctx, bursts, elapsed, (p) => f.point(p), TheaterType.bannerOrigin(size, pt), () => palette, size);
        }
      },
      bursts: (height) => (first ? GoalCelebration.theater(replay.moment, first.scene, first.script, level, reduceMotion, height) : []),
      bloom(size) {
        // The end state: a bloom over the net it went into.
        const moment = replay.moment;
        if (!first || !moment) return null;
        const { scene, script } = first;
        if (moment.id !== scene.id || !scored(scene) || scene.review === "overturned" || level === "off") return null;
        const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: Math.PI / 2 });
        if (!cue) return null;
        const goal = goalOf(scene);
        const origin = new PitchProjection(size, script.frame(Infinity)).point({ x: goal.x, y: goal.y, z: 1.2 });
        return { cue, origin, palette: teamPalette(accentOf(teams(scene.side).attacking, ink), ink) };
      },
    };
  },
};
