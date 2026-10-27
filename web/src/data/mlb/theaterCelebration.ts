/**
 * The play theater's celebrations (PlayTheater.swift `PlateCelebration`):
 * one celebration per moment, and the theater owns its plays' when the page
 * shows it: a home run's fireworks burst at the wall it cleared (the spray
 * chart only flies its ball in), with confetti off the banner; a triple's
 * and a walk-off's confetti come off the banner too. Every burst goes
 * through the page's rules (`cueFor`): the celebration level, Reduce Motion,
 * and one particle burst every 10 s. (pure; tested)
 */
import { cueDuration, cueFor, presetFor, theaterBursts, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import { decisive, type LiveMoment } from "../moments";
import type { PlayScene } from "./playScene";
import type { PlayScript } from "./playScript";
import type { FieldPoint } from "./theaterField";

/** The spray chart bursts over a home run only when there's no theater to. */
export const sprayChartBursts = (theaterShown: boolean): boolean => !theaterShown;

/** A burst on the theater's stage. */
export interface TheaterBurst {
  readonly cue: CelebrationCue;
  /** Script time it mounts (its cue's own delay comes after). */
  readonly at: number;
  /** A point on the field (it moves with the camera), or under the headline. */
  readonly anchor: { readonly kind: "field"; readonly point: FieldPoint } | { readonly kind: "banner" };
  /** Larger than the charts' bursts: the theater is the stage. */
  readonly scale: number;
}

export const burstEnd = (b: TheaterBurst): number => b.at + cueDuration(b.cue);

/** The theater's bursts for this play's moment, in script time. Nothing for another play's moment, or when the level is Off. */
export function plateCelebration(
  moment: LiveMoment | null,
  play: PlayScene,
  script: PlayScript,
  level: CelebrationLevel,
  reduceMotion: boolean,
  height: number,
): TheaterBurst[] {
  if (!moment || moment.id !== play.id || moment.chart !== "plate") return [];
  const bursts: TheaterBurst[] = [];
  const gold = moment.accents.has("grandSlam") || decisive(moment);
  const cue = (effects: readonly Effect[]): CelebrationCue | null => {
    const c = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: Math.PI / 2, effects });
    return c && gold ? { ...c, gold: true } : c;
  };
  // The theater is the stage: bursts grow with the well (the charts' are sized for their own).
  const scale = Math.max(2.2, height / 95);
  if (moment.kind === "homeRun" && script.fence) {
    // The shells burst as the ball clears the wall: two, three for a grand slam or a walk-off.
    const fireworks = cue([{ kind: "fireworks", shells: decisive(moment) ? 3 : moment.accents.has("grandSlam") ? 3 : 2 }]);
    if (fireworks) bursts.push({ cue: fireworks, at: script.fence.at - fireworks.delay, anchor: { kind: "field", point: script.fence.point }, scale });
  }
  // The banner's confetti: only ever confetti (Subtle, the cooldown and Reduce Motion leave the banner alone).
  const banner = script.banner;
  if (banner?.confetti && (moment.kind === "homeRun" || theaterBursts(moment))) {
    const confetti = cue([{ kind: "confetti", direction: Math.PI / 2, spread: (150 * Math.PI) / 180, preset: "medium" }]);
    if (confetti && confetti.effects.some((e) => e.kind === "confetti")) {
      const at = moment.kind === "homeRun" ? (script.fence?.at ?? banner.at) + 0.12 : banner.at + 0.05;
      bursts.push({ cue: confetti, at: at - confetti.delay, anchor: { kind: "banner" }, scale: scale * 0.7 });
    }
  }
  return bursts;
}
