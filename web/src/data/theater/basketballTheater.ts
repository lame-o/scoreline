/**
 * The basketball theater's pure rules (BasketballTheater.swift
 * `BasketballTheater.shown`, `BasketballCelebration`; BasketballFeed.swift
 * `theater`, `updateTheater`): which play the theater shows and whether
 * it's news, the lane's theater kept beside the lane, and the one
 * celebration per moment the theater owns when the page shows it. The
 * drawing is features/game/nba/theater/.
 */
import { cueFor, presetFor, sparks, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import type { JSONValue } from "../json";
import type { Teams } from "../liveFeeds/basketball";
import { RECENT_MS } from "../liveFeeds/baseball";
import type { TheaterBurst } from "../mlb/theaterCelebration";
import type { Side } from "../models";
import { decisive, type LiveMoment } from "../moments";
import { basketballNewest, made, sameScene, type BasketballScene, type BasketballTheaterState } from "./basketballScene";
import { Hoops, type BasketballScript } from "./basketballScript";
import { TheaterBurst as Burst } from "./theaterKit";

// MARK: - What the theater shows

/**
 * What the stage shows (BasketballTheater.shown): a play replaying, then its
 * end until it has held (`rested`); a new play not yet begun; otherwise
 * null, the game as it stands (the team with the ball set in its half).
 * History that isn't news is never shown: on opening the page, the court is
 * the live one. (pure; tested)
 */
export function basketballShown(state: BasketballTheaterState, replaying: string | null, rested: string | null): BasketballScene | null {
  const scene = state.scene;
  if (!scene) return null;
  if (replaying === scene.id) return rested === scene.id ? null : scene;
  return state.news ? scene : null;
}

/**
 * The theater after a look at the plays. A play already showing keeps what
 * it was (news or not), edits and all. (BasketballFeed.theater; pure)
 */
export function basketballTheaterState(scene: BasketballScene, previous: BasketballTheaterState, fresh: boolean, now: number): BasketballTheaterState {
  return {
    ...previous,
    news: scene.id === previous.scene?.id ? previous.news : fresh || (scene.wallclock != null && now - scene.wallclock < RECENT_MS),
    scene,
  };
}

/**
 * The lane's theater, kept beside the lane (BasketballFeed's `theater` and
 * `updateTheater`): after each change to the lane's plays, the newest worth
 * replaying among the newest plays (only those are read). It's news if it
 * arrived after the first complete look and is still recent (a block or an
 * assist ESPN adds a few looks late still counts), or if it only just
 * happened. Assigned only when it changes.
 */
export class BasketballTheaterWatch {
  state: BasketballTheaterState = { scene: null, news: false };
  private items: readonly JSONValue[] | null = null;

  /** `looks`: the lane's complete looks so far; `seenIn`: the look a play was first seen in. True when the state changed. */
  update(items: readonly JSONValue[], teams: Teams, looks: number, seenIn: (id: string) => number | null, now: number = Date.now()): boolean {
    if (items === this.items) return false;
    this.items = items;
    const scene = basketballNewest(items, teams);
    if (!scene) return false;
    // The first look is history: a play is news only from a later look it first appeared in.
    const seen = seenIn(scene.id) ?? looks;
    const fresh = seen > 1 && looks - seen <= 3;
    const next = basketballTheaterState(scene, this.state, fresh, now);
    if (next.news === this.state.news && sameScene(next.scene, this.state.scene)) return false;
    this.state = next;
    return true;
  }
}

// MARK: - Celebration

/** A burst on the theater's stage, in whose colors. */
export interface BasketballBurst extends TheaterBurst {
  readonly side: Side | null;
}

const DEG = Math.PI / 180;

/**
 * One celebration per moment, and the theater owns its plays' when the page
 * shows it (the shot chart keeps its marks and its shot story, and bursts
 * nothing): a three's sparks at the rim as it drops, a clutch basket's, a
 * hot hand's embers, a buzzer-beater's confetti off its banner (gold when it
 * tied or won it). The net, the rim and the banner are the rest: a two, a
 * dunk, a block get no particles. Every burst goes through the page's rules
 * (`cueFor`): the celebration level, Reduce Motion, and one particle burst
 * every 10 s. (pure; tested)
 */
export const BasketballCelebration = {
  /** The shot chart bursts only when there's no theater to. */
  courtBursts(theaterShown: boolean): boolean {
    return !theaterShown;
  },

  /** The theater's bursts for this play's moment, in script time. Nothing for another play's moment, or when the level is Off. */
  theater(moment: LiveMoment | null, play: BasketballScene, script: BasketballScript, level: CelebrationLevel, reduceMotion: boolean, height: number): BasketballBurst[] {
    const at = script.score;
    if (!moment || moment.id !== play.id || moment.chart !== "court" || !made(play) || at == null) return [];
    const scale = Burst.scale(height);
    const cue = (effects: readonly Effect[]): CelebrationCue | null => {
      if (effects.length === 0) return null;
      const c = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: 90 * DEG, effects });
      return c && (decisive(moment) || play.decisive) ? { ...c, gold: true } : c;
    };
    const bursts: BasketballBurst[] = [];
    // At the rim: a three's sparks, a clutch two's; a hot hand's embers.
    const rim: Effect[] = [];
    if (play.value >= 3) rim.push(sparks(6, 13));
    else if (moment.accents.has("clutch")) rim.push(sparks(4, 13));
    if (moment.accents.has("onFire")) rim.push({ kind: "embers" });
    const glints = cue(rim);
    if (glints) {
      bursts.push({ cue: glints, at: at - glints.delay, anchor: { kind: "field", point: { x: Hoops.rim.x, y: Hoops.rim.y, z: Hoops.rimHeight } }, scale: scale * 0.7, side: play.offense });
    }
    // The buzzer-beater's banner brings its confetti (only ever confetti: Subtle, the cooldown and Reduce Motion leave the banner alone).
    const banner = script.banner;
    if (banner?.confetti) {
      const confetti = cue([{ kind: "confetti", direction: 90 * DEG, spread: (play.decisive ? 170 : 150) * DEG, preset: "medium" }]);
      if (confetti && confetti.effects.some((e) => e.kind === "confetti")) {
        bursts.push({ cue: confetti, at: banner.at + 0.1 - confetti.delay, anchor: { kind: "banner" }, scale: scale * (play.decisive ? 0.85 : 0.7), side: play.offense });
      }
    }
    return bursts;
  },
};
