/**
 * The basketball theater's pure rules (BasketballFeed.swift `theater`,
 * `updateTheater`; BasketballTheater.swift `BasketballCelebration`): the
 * newest plays the theater tells and which are news, the lane's theater kept
 * beside the lane, and the one celebration per moment the theater owns when
 * the page shows it. The running order is basketballFlow.ts; the drawing is
 * features/game/nba/theater/.
 */
import { cueFor, presetFor, sparks, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import type { JSONValue } from "../json";
import type { Teams } from "../liveFeeds/basketball";
import { RECENT_MS } from "../liveFeeds/baseball";
import type { TheaterBurst } from "../mlb/theaterCelebration";
import type { Side } from "../models";
import { decisive, type LiveMoment } from "../moments";
import { basketballRecent, made, sameScene, type BasketballScene, type BasketballTheaterState } from "./basketballScene";
import { Hoops, type BasketballScript } from "./basketballScript";
import { TheaterBurst as Burst } from "./theaterKit";

// MARK: - What the theater tells

export const NO_PLAYS: BasketballTheaterState = { plays: [], news: new Set(), heard: null };

/**
 * The theater after a look at the plays (BasketballFeed.theater): the
 * newest plays, every kind. A play is news if it first appeared after the
 * first complete look (`seenIn`: the look it was first seen in), or if it
 * only just happened; a play that was news stays news, edits and all.
 * `heard` moves when a new play comes. (pure; tested)
 */
export function basketballTheaterState(
  plays: readonly BasketballScene[],
  previous: BasketballTheaterState,
  looks: number,
  seenIn: (id: string) => number | null,
  now: number,
): BasketballTheaterState {
  const ids = new Set(plays.map((p) => p.id));
  const news = new Set([...previous.news].filter((id) => ids.has(id)));
  for (const scene of plays) {
    if (news.has(scene.id)) continue;
    const seen = seenIn(scene.id) ?? looks;
    if (seen > 1 || (scene.wallclock != null && now - scene.wallclock < RECENT_MS)) news.add(scene.id);
  }
  const before = new Set(previous.plays.map((p) => p.id));
  const heard = previous.heard == null || [...ids].some((id) => !before.has(id)) ? now : previous.heard;
  return { plays, news, heard };
}

/** Swift's `BasketballTheaterState ==`. */
export function sameTheaterState(a: BasketballTheaterState, b: BasketballTheaterState): boolean {
  if (a === b) return true;
  if (a.heard !== b.heard || a.plays.length !== b.plays.length || a.news.size !== b.news.size) return false;
  for (const id of a.news) if (!b.news.has(id)) return false;
  return a.plays.every((p, i) => sameScene(p, b.plays[i]!));
}

/**
 * The lane's theater, kept beside the lane (BasketballFeed's `theater` and
 * `updateTheater`): after each change to the lane's plays, the newest plays
 * (only those are read) and which are news. Assigned only when it changes.
 */
export class BasketballTheaterWatch {
  state: BasketballTheaterState = NO_PLAYS;
  private items: readonly JSONValue[] | null = null;

  /** `looks`: the lane's complete looks so far; `seenIn`: the look a play was first seen in. True when the state changed. */
  update(items: readonly JSONValue[], teams: Teams, looks: number, seenIn: (id: string) => number | null, now: number = Date.now()): boolean {
    if (items === this.items) return false;
    this.items = items;
    const next = basketballTheaterState(basketballRecent(items, teams), this.state, looks, seenIn, now);
    if (sameTheaterState(next, this.state)) return false;
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
