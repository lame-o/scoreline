/**
 * The basketball theater's pure rules (BasketballFeed.swift `theater`,
 * `updateTheater`; BasketballTheater.swift `BasketballCelebration` and
 * § Names): the newest plays the theater tells and which are news, the
 * lane's theater kept beside the lane, the one celebration per moment the
 * theater owns when the page shows it, and who each figure is for the names
 * over the court. The running order is basketballFlow.ts; the drawing is
 * features/game/nba/theater/.
 */
import { cueFor, presetFor, sparks, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import type { JSONValue } from "../json";
import type { Teams } from "../liveFeeds/basketball";
import { RECENT_MS } from "../liveFeeds/baseball";
import type { TheaterBurst } from "../mlb/theaterCelebration";
import type { Side } from "../models";
import { decisive, opposite, type LiveMoment } from "../moments";
import { basketballRecent, made, sameScene, type BasketballScene, type BasketballTheaterState, type Person } from "./basketballScene";
import { Hoops, type BasketballScript } from "./basketballScript";
import { remainder } from "./rig";
import { bridgePlan, TheaterBridge, type BridgePlan } from "./theaterBridge";
import { TheaterBurst as Burst } from "./theaterKit";
import { known, TEAM_ONLY, TheaterCast, theaterPerson, type CastMember, type TheaterPerson } from "./theaterNames";

// MARK: - What the theater tells

export const NO_PLAYS: BasketballTheaterState = { plays: [], news: new Set(), heard: null };

/**
 * The theater after a look at the plays (BasketballFeed.theater): the
 * newest plays, every kind. A play is news if it first appeared after the
 * first complete look (`seenIn`: the look it was first seen in), or if it
 * only just happened; a play that was news stays news, edits and all. The
 * first look is history, as is one catching up on coming back to the page
 * (`history`: the last such, `BasketballFeed.history`). `heard` moves when
 * a new play comes. (pure; tested)
 */
export function basketballTheaterState(
  plays: readonly BasketballScene[],
  previous: BasketballTheaterState,
  looks: number,
  seenIn: (id: string) => number | null,
  now: number,
  history = 1,
): BasketballTheaterState {
  const ids = new Set(plays.map((p) => p.id));
  const news = new Set([...previous.news].filter((id) => ids.has(id)));
  for (const scene of plays) {
    if (news.has(scene.id)) continue;
    const seen = seenIn(scene.id) ?? looks;
    if (seen > history || (scene.wallclock != null && now - scene.wallclock < RECENT_MS)) news.add(scene.id);
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

  /**
   * `looks`: the lane's complete looks so far; `seenIn`: the look a play was
   * first seen in; `history`: the last look that's history (the first, or
   * one catching up on coming back: `BasketballFeed.history`). True when
   * the state changed.
   */
  update(items: readonly JSONValue[], teams: Teams, looks: number, seenIn: (id: string) => number | null, now: number = Date.now(), history = 1): boolean {
    if (items === this.items) return false;
    this.items = items;
    const next = basketballTheaterState(basketballRecent(items, teams), this.state, looks, seenIn, now, history);
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
/**
 * How the court between plays on screen (`rest` at `t`) meets a replay that
 * comes in now (BasketballTheater.bridge): each man from where he is in the
 * set to his place in the replay's, unless the replay's set is far from
 * where the court stands (the other end, the ball the other way:
 * `TheaterBridge.far.basketball`), or Reduce Motion: then a crossfade. (pure; tested)
 */
export function basketballBridge(rest: BasketballScript, t: number, replay: BasketballScript, reduceMotion: boolean, beatLeft: number | null = null): BridgePlan {
  const together = rest.side === replay.side && Math.abs(remainder(rest.yaw - replay.yaw, 2 * Math.PI)) < 0.3;
  return bridgePlan(rest.bridgeFigures(t), replay.bridgeFigures(0), { room: replay.leadIn, far: TheaterBridge.far.basketball, together, reduceMotion, beatLeft });
}

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

// MARK: - Names

/**
 * Who each figure is, for the names over the court (BasketballTheater.swift
 * § Names): the men ESPN credits on the play (`credits`: the shooter, the
 * passer, the blocker, the rebounder, the man who fouled or lost it, the man
 * coming in), by the box score's number and position (their names alone
 * until it has them); every other man on the floor his team's, which of them
 * unknown (the data says who's on the floor, not which figure is which); the
 * referee nobody. `scope`: the script's own key. (pure; tested)
 */
export function basketballCast(script: BasketballScript, scene: BasketballScene | null, people: Readonly<Record<string, TheaterPerson>>, scope: string): TheaterCast {
  const offense: Side = script.side ?? scene?.offense ?? "top";
  const members = new Map<number, CastMember>();
  script.players.forEach((player, i) => {
    if (player.team === "official") return;
    const side = player.team === "offense" ? offense : opposite(offense);
    const credit = script.credits.get(i) ?? null;
    const named = credit ? ((credit.id != null ? people[credit.id] : undefined) ?? (credit.name.length > 0 ? theaterPerson(credit.name, credit.name) : null)) : null;
    members.set(i, TheaterCast.member(named ? known(named) : TEAM_ONLY, side, credit?.id ?? credit?.name, i, scope));
  });
  const person = basketballKey(scene);
  let key: number | null = null;
  if (person) {
    // The figure credited as him, by ID (by name when ESPN gave none); the first, when he's credited twice.
    for (const [i, c] of [...script.credits].sort((a, b) => a[0] - b[0])) {
      if (c.id != null ? c.id === person.id : c.name === person.name) {
        key = i;
        break;
      }
    }
  }
  return TheaterCast.of(members, key, scope);
}

/**
 * Who a play is about: the man its text leads with (the shooter, a free
 * throw's too; the man who lost it; the rebounder; the man whistled), the
 * blocker on a block, the man coming in on a substitution, whoever came up
 * with a jump ball. A timeout, the end of a period, a review, the court
 * between plays: nobody. (pure; tested)
 */
export function basketballKey(scene: BasketballScene | null): Person | null {
  if (!scene) return null;
  switch (scene.kind) {
    case "block":
      return scene.blocker;
    case "substitution":
      return scene.subIn;
    case "jumpBall":
      return scene.winner;
    case "timeout":
    case "periodEnd":
    case "challenge":
      return null;
    default:
      return scene.shooter;
  }
}
