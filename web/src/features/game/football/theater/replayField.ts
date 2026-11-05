/**
 * A football play replayed under its row (ReplayWell.swift's `.football`
 * take and frame): the snap, then a touchdown's try a breath after it, as
 * the live theater follows it, each scripted as the live theater scripts it
 * (FootballTheater.tsx) and facing the way the game's turn of the field puts
 * it for the play's quarter. The field, the stamp, the tag (what the replay
 * says while it plays; nothing under its headline), the celebration (its
 * moment as the live lane offered it, for the snap) and the names, as the
 * live theater draws them. Its own chunk, loaded with the well.
 */
import { cueFor, presetFor } from "../../../../data/celebrations";
import { dress } from "../../../../data/mlb/theaterTeams";
import type { Side } from "../../../../data/models";
import { replayCodes, replayKits, replayTeams, type ReplayScene } from "../../../../data/replays";
import { NEUTRAL, type Scheme } from "../../../../data/teamColors";
import { FieldFacing, FootballStatus, type StatusNames } from "../../../../data/theater/footballIdle";
import type { FootballScene } from "../../../../data/theater/footballScene";
import { FootballScript } from "../../../../data/theater/footballScript";
import { FootballCelebration, footballCast, type FootballBurst } from "../../../../data/theater/footballTheater";
import { theaterLabels, type TheaterCast } from "../../../../data/theater/theaterNames";
import { NO_STATUS, perTake, tagColor, type ReplaySport } from "../../core/replay/replayDrawing";
import { accentOf, drawBursts, teamPalette, TheaterType } from "../../core/theater/theaterKit";
import { theaterInk } from "../../mlb/theater/theaterInk";
import { drawFootballFrame, drawGridiron, footballProjection, GridProjection, hitFigures, layoutLabels, type EndZone, type FootballTeams } from "./drawFootball";

/** One take of a football replay: the snap as drawn, and its script. */
export interface FootballTake {
  readonly scene: FootballScene;
  readonly script: FootballScript;
}

/**
 * A replay's takes, scripted as the live theater scripts them: the play's
 * (and a touchdown's try after it), facing the way the game's turn of the
 * field puts it for the play's quarter. (ReplayTake.takes; pure; tested)
 */
export function footballTakes(scene: ReplayScene, flipped: boolean): FootballTake[] {
  if (scene.kind !== "football") return [];
  const snap = scene.scene;
  const try_ = snap.conversion;
  return [snap, ...(try_ ? [try_] : [])].map((s) => ({ scene: s, script: FootballScript.play(s, FieldFacing.yaw(s.offense, s.period, flipped)) }));
}

/** A team's end-zone color (TheaterTeams.solid): its own, or a gray for one with none. */
function solid(color: string, scheme: Scheme): string {
  return color === NEUTRAL || !color.startsWith("#") ? (scheme === "dark" ? "#b8b8b8" : "#808080") : color;
}

export const footballReplay: ReplaySport<FootballTake> = {
  takes: (scene, flipped) => footballTakes(scene, flipped),

  drawing(takes, replay, context, look) {
    const { scheme, flipped, level, reduceMotion } = look;
    const kits = replayKits(context);
    const dressed = dress(kits, scheme);
    const ink = theaterInk(scheme);
    const teams = (offense: Side): FootballTeams => (offense === "top" ? { offense: dressed.top, defense: dressed.bottom } : { offense: dressed.bottom, defense: dressed.top });
    const codes = replayCodes(context);
    const full = replayTeams(context);
    // The end zones: the offense's own nearest the camera, the one it attacks at the far end.
    const zones = (offense: Side): { near: EndZone; far: EndZone } => {
      const top: EndZone = { color: solid(context.palette.top, scheme), name: codes.top.toUpperCase() };
      const bottom: EndZone = { color: solid(context.palette.bottom, scheme), name: codes.bottom.toUpperCase() };
      return offense === "top" ? { near: top, far: bottom } : { near: bottom, far: top };
    };
    const names: StatusNames = { top: full.top, bottom: full.bottom, topColor: tagColor(kits.top.color), bottomColor: tagColor(kits.bottom.color) };
    const tagLabels = theaterLabels(kits, scheme, full);
    const casts = new Map<number, TheaterCast>();
    // Who each figure in a take is, as the live stage names them.
    const castOf = (i: number): TheaterCast => {
      let cast = casts.get(i);
      if (!cast) {
        const { scene, script } = takes[i]!;
        cast = footballCast(script, scene, scene.offense ?? "top", context.people, `replay|${scene.id}|${flipped}`);
        casts.set(i, cast);
      }
      return cast;
    };
    const labelsFor = perTake((i, ctx, size, pt) => {
      const { scene, script } = takes[i]!;
      return layoutLabels(ctx, scene, script, teams(scene.offense ?? "top"), ink, size, pt);
    });
    const first = takes[0];
    const color = (side: Side | null) => {
      const offense = first?.scene.offense ?? "top";
      const t = teams(offense);
      return side == null || side === offense ? accentOf(t.offense, ink) : accentOf(t.defense, ink);
    };
    const status = (i: number, t: number) => {
      const take = takes[i];
      if (!take) return NO_STATUS;
      // The headline says it for itself.
      const banner = take.script.banner;
      if (banner && t >= banner.at - 0.3 && t < banner.until + 0.3) return NO_STATUS;
      return FootballStatus.replay(take.scene, take.script, t, names);
    };
    return {
      lengths: takes.map((t) => t.script.duration),
      ended: () => Infinity,
      corner: "trailing",
      status,
      paint(ctx, size, pt, i, t, elapsed, bursts, tagged) {
        const take = takes[i];
        if (!take) return;
        const { scene, script } = take;
        const offense = scene.offense ?? "top";
        const f = footballProjection(size, script, t);
        const tags = tagged.frame(castOf(i), tagLabels, { status: status(i, t).tag, flip: false, heartbeat: "trailing" }, () => hitFigures(f, script, t));
        const zone = zones(offense);
        drawGridiron(ctx, f, ink, zone.near, zone.far);
        drawFootballFrame(ctx, f, { script, t, teams: teams(offense), ink, labels: labelsFor(i, ctx, size, pt), tags });
        if (bursts.length > 0 && first) {
          // The snap's celebration, through its own camera, from when the replay began.
          const g = i === 0 ? f : footballProjection(size, first.script, elapsed);
          drawBursts(ctx, bursts, elapsed, (p) => g.at(p), TheaterType.bannerOrigin(size, pt), (b) => teamPalette(color((b as FootballBurst).side ?? null), ink), size);
        }
      },
      bursts: (height) => (first ? FootballCelebration.theater(replay.moment, first.scene, first.script, level, reduceMotion, height) : []),
      bloom(size) {
        // The end state: a bloom where the score happened, through the rest framing (Reduce Motion never moves the camera).
        const moment = replay.moment;
        if (!first || !moment) return null;
        const { scene, script } = first;
        const point = script.scorePoint ?? script.end;
        if (moment.id !== scene.id || moment.kind !== "touchdown" || !point || level === "off") return null;
        const cue = cueFor(moment, { level, reduceMotion: true, preset: presetFor(size.height), direction: Math.PI / 2 });
        if (!cue) return null;
        const origin = new GridProjection(size, script.camera.rest, script.yawAt(Infinity)).at(point);
        return { cue, origin, palette: teamPalette(color(scene.scorer), ink) };
      },
    };
  },
};
