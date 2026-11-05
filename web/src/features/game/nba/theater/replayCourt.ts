/**
 * A basketball play replayed under its row (ReplayWell.swift's
 * `.basketball` take and frame): the play scripted as the live theater
 * scripts a marquee replay (BasketballTheater.tsx), at the ends the
 * broadcast's convention puts the teams for its period and the game's turn
 * of the court. The court with the paint in the home team's color, the
 * stamp, the celebration (its moment as the live lane offered it) and the
 * names; the tag says nothing (a marquee replay's never does:
 * BasketballStatus.during). It holds on its last frame, where everyone
 * still stands. Its own chunk, loaded with the well.
 */
import { cueFor, presetFor } from "../../../../data/celebrations";
import { dress } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { replayCodes, replayKits, replayTeams, type ReplayScene } from "../../../../data/replays";
import { NEUTRAL, type Scheme } from "../../../../data/teamColors";
import { endsRight, hoopsEnds } from "../../../../data/theater/basketballBeats";
import type { BasketballScene } from "../../../../data/theater/basketballScene";
import { BasketballScript, Hoops } from "../../../../data/theater/basketballScript";
import { basketballCast, BasketballCelebration, type BasketballBurst } from "../../../../data/theater/basketballTheater";
import { theaterLabels, type HitFigure, type TheaterCast } from "../../../../data/theater/theaterNames";
import { NO_STATUS, perTake, type ReplaySport } from "../../core/replay/replayDrawing";
import { accentOf, drawBursts, teamPalette, TheaterType } from "../../core/theater/theaterKit";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { basketballProjection, drawBasketballFrame, drawCourt, HoopProjection, layoutLabels, type BasketballTeams, type Paint } from "./drawBasketball";

/** One take of a basketball replay: the play as drawn, and its script. */
export interface BasketballTake {
  readonly scene: BasketballScene;
  readonly script: BasketballScript;
}

/**
 * A replay's take, scripted as the live theater scripts it, at the ends the
 * game's turn of the court puts it for the play's period (the ends swap at
 * halftime). (ReplayTake.takes; pure; tested)
 */
export function basketballTakes(scene: ReplayScene, flipped: boolean, topIsHome: boolean): BasketballTake[] {
  if (scene.kind !== "basketball") return [];
  const play = scene.scene;
  const ends = hoopsEnds(play.period, topIsHome, flipped);
  return [{ scene: play, script: BasketballScript.play(play, endsRight(ends, play.offense)) }];
}

/** A team's paint (TheaterTeams.solid): its own color, or a gray for one with none. */
function solid(color: string, scheme: Scheme): string {
  return color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color;
}

/** The rim the offense attacks: where Reduce Motion's bloom goes. */
const RIM = { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight };

export const basketballReplay: ReplaySport<BasketballTake> = {
  takes: (scene, flipped, context) => basketballTakes(scene, flipped, context.topIsHome),

  drawing(takes, replay, context, look) {
    const { scheme, flipped, level, reduceMotion } = look;
    const kits = replayKits(context);
    const dressed = dress(kits, scheme);
    const ink = theaterInk(scheme);
    const teams = (side: Side): BasketballTeams => (side === "top" ? { offense: dressed.top, defense: dressed.bottom } : { offense: dressed.bottom, defense: dressed.top });
    const codes = replayCodes(context);
    // The paint in the home team's color, its name at center court.
    const paint: Paint = {
      color: solid(context.topIsHome ? context.palette.top : context.palette.bottom, scheme),
      name: (context.topIsHome ? codes.top : codes.bottom).toUpperCase(),
      three: Hoops.three,
    };
    const tagLabels = theaterLabels(kits, scheme, replayTeams(context));
    const casts = new Map<number, TheaterCast>();
    const castOf = (i: number): TheaterCast => {
      let cast = casts.get(i);
      if (!cast) {
        const { scene, script } = takes[i]!;
        cast = basketballCast(script, scene, context.people, `replay|${scene.id}|${flipped}`);
        casts.set(i, cast);
      }
      return cast;
    };
    const labelsFor = perTake((i, ctx, size, pt) => {
      const { scene, script } = takes[i]!;
      return layoutLabels(ctx, scene, script, teams(script.side ?? "top"), ink, size, pt);
    });
    const first = takes[0];
    const color = (side: Side | null) => {
      const offense = first?.script.side ?? "top";
      const t = teams(offense);
      return side == null || side === offense ? accentOf(t.offense, ink) : accentOf(t.defense, ink);
    };
    return {
      lengths: takes.map((t) => t.script.duration),
      // Its last frame, where everyone still stands (its men fade out by Infinity).
      ended: (i) => takes[i]?.script.duration ?? Infinity,
      corner: "trailing",
      // A marquee replay's tag says nothing (BasketballStatus.during).
      status: () => NO_STATUS,
      paint(ctx, size, pt, i, t, elapsed, bursts, tagged) {
        const take = takes[i];
        if (!take) return;
        const { script } = take;
        const h = basketballProjection(size, script, t);
        // The names: the pointer's man hit-tested on this frame's players (each one's spot at t through the camera, no posing).
        const hits = (): HitFigure[] =>
          script.players.flatMap((player, index) => {
            if (!(player.opacity(t) > 0.01)) return [];
            const lens = h.lens(player.position(t));
            return [{ index, ground: lens.origin, height: lens.height }];
          });
        const tags = tagged.frame(castOf(i), tagLabels, { status: null, flip: false, heartbeat: "trailing" }, hits);
        drawCourt(ctx, h, ink, paint);
        drawBasketballFrame(ctx, h, { script, t, teams: teams(script.side ?? "top"), ink, labels: labelsFor(i, ctx, size, pt), tags });
        if (bursts.length > 0) {
          drawBursts(ctx, bursts, elapsed, (p) => h.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as BasketballBurst).side ?? null), ink), size);
        }
      },
      bursts: (height) => (first ? BasketballCelebration.theater(replay.moment, first.scene, first.script, level, reduceMotion, height) : []),
      bloom(size) {
        // With Reduce Motion there's no replay: a basket that celebrates blooms at the rim, as the play's end shows.
        const moment = replay.moment;
        if (!first || !moment) return null;
        const { scene, script } = first;
        if (moment.id !== scene.id || BasketballCelebration.theater(moment, scene, script, level, true, size.height).length === 0) return null;
        const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: -Math.PI / 2 });
        if (!cue) return null;
        const origin = new HoopProjection(size, script.camera.rest, script.yaw).at(RIM);
        return { cue, origin, palette: teamPalette(color(scene.offense), ink) };
      },
    };
  },
};
