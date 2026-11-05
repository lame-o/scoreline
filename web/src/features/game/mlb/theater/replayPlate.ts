/**
 * A baseball play replayed under its row (ReplayWell.swift's `.baseball`
 * take and frame): one take (the diamond never turns), scripted as the play
 * theater scripts it (PlayTheater.tsx: the pitch, the ball in play, the
 * throws, each runner's legs; MLB's account where it has the play), settling
 * on the field the play leaves. The field, the scorer's mark and Statcast's
 * line, the celebration (its moment as the live lane offered it: a home
 * run's fireworks at the wall) and the names; the tag says nothing (its
 * headline and mark tell it). Its own chunk, loaded with the well.
 */
import { cueFor, presetFor, type CelebrationPalette } from "../../../../data/celebrations";
import type { BaseballNow } from "../../../../data/mlb/fielders";
import { NO_FIELDERS } from "../../../../data/mlb/fielders";
import { restCamera } from "../../../../data/mlb/playCamera";
import { playCast } from "../../../../data/mlb/playNames";
import type { PlayScene } from "../../../../data/mlb/playScene";
import { PlayScript } from "../../../../data/mlb/playScript";
import { plateCelebration } from "../../../../data/mlb/theaterCelebration";
import { theaterTeams } from "../../../../data/mlb/theaterTeams";
import { replayKits, replayTeams, type ReplayScene } from "../../../../data/replays";
import { theaterLabels, type HitFigure, type TheaterCast } from "../../../../data/theater/theaterNames";
import { NO_STATUS, perTake, type ReplaySport } from "../../core/replay/replayDrawing";
import { RigLens } from "../../core/theater/rigFigure";
import { drawBursts, drawField, drawFrame, FieldProjection, layoutLabels } from "./drawTheater";
import { mixHex, rgba, theaterInk } from "./theaterInk";

/** One take of a baseball replay: the play, and its script. */
export interface BaseballTake {
  readonly scene: PlayScene;
  readonly script: PlayScript;
}

/** A replay's take, scripted as the play theater scripts it: one, the diamond never turns. (ReplayTake.takes; pure; tested) */
export function baseballTakes(scene: ReplayScene): BaseballTake[] {
  if (scene.kind !== "baseball") return [];
  return [{ scene: scene.play, script: PlayScript.play(scene.play, scene.rest) }];
}

export const baseballReplay: ReplaySport<BaseballTake> = {
  takes: (scene) => baseballTakes(scene),

  drawing(takes, replay, context, look) {
    const { scheme, level, reduceMotion } = look;
    const kits = replayKits(context);
    const ink = theaterInk(scheme);
    const first = takes[0];
    const side = first?.scene.batting ?? "top";
    const teams = theaterTeams(kits, scheme, side);
    const tagLabels = theaterLabels(kits, scheme, replayTeams(context));
    const now: BaseballNow = { side, batter: null, pitcher: null, runners: [null, null, null] };
    const casts = new Map<number, TheaterCast>();
    const castOf = (i: number): TheaterCast => {
      let cast = casts.get(i);
      if (!cast) {
        const { scene, script } = takes[i]!;
        cast = playCast(script, scene, null, side, context.fielders ?? NO_FIELDERS, context.people, context.numbers, now, `replay|${scene.id}`);
        casts.set(i, cast);
      }
      return cast;
    };
    const labelsFor = perTake((i, ctx, size, pt) => {
      const { scene, script } = takes[i]!;
      return layoutLabels(ctx, { scene, script, teams, ink, size, pt, statcast: scene.readout });
    });
    // The batting team's colors (TheaterCelebration's).
    const primary = teams.batting.accent ?? ink.accent;
    const palette: CelebrationPalette = {
      primary,
      tint: mixHex(primary, "#ffffff", 0.4),
      neutral: rgba(ink.primary, 0.55),
      gold: ink.yellow,
      glint: rgba(ink.primary, 0.8),
      edge: rgba(ink.primary, 0.5),
    };
    return {
      lengths: takes.map((t) => t.script.duration),
      ended: () => Infinity,
      corner: "trailing",
      // A replay says nothing in the tag: its headline and mark tell it.
      status: () => NO_STATUS,
      paint(ctx, size, pt, i, t, elapsed, bursts, tagged) {
        const take = takes[i];
        if (!take) return;
        const { scene, script } = take;
        const f = new FieldProjection(size, script.camera.frame(t));
        const hits = (): HitFigure[] =>
          script.actors.flatMap((a, index) => {
            if (!(a.opacity(t) > 0.01)) return [];
            const lens = RigLens.field(f, a.position(t));
            return [{ index, ground: lens.origin, height: lens.height }];
          });
        const tags = tagged.frame(castOf(i), tagLabels, { status: null, flip: false, heartbeat: "trailing" }, hits);
        drawField(ctx, f, ink);
        drawFrame(ctx, f, { scene, script, t, teams, ink, labels: labelsFor(i, ctx, size, pt), tags });
        if (bursts.length > 0) drawBursts(ctx, f, bursts, elapsed, palette, pt);
      },
      bursts: (height) => (first ? plateCelebration(replay.moment, first.scene, first.script, level, reduceMotion, height) : []),
      bloom(size) {
        // The end state: a bloom where the runs crossed, through the rest framing (Reduce Motion never moves the camera).
        const m = replay.moment;
        if (!first || !m || m.id !== first.scene.id || m.kind !== "homeRun" || level === "off") return null;
        const cue = cueFor(m, { level, reduceMotion: true, preset: presetFor(size.height), direction: -Math.PI / 2 });
        if (!cue) return null;
        return { cue, origin: new FieldProjection(size, restCamera()).at({ x: 0, y: 0, z: 0 }), palette };
      },
    };
  },
};
