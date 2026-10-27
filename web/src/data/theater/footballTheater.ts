/**
 * The football theater's pure rules (FootballTheater.swift `FootballTheater.rest`,
 * `FootballCelebration`; LiveFeeds.swift `FootballFeed.theater`): the field
 * between plays from the live situation, which snap the theater shows and
 * whether it's news, and the one celebration per moment the theater owns
 * when the page shows it. The drawing is features/game/football/theater/.
 */
import { cueFor, presetFor, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import type { Football } from "../gameDetail";
import { at, num, str, type JSONValue } from "../json";
import type { FootballTeams } from "../liveFeeds/football";
import type { TheaterBurst } from "../mlb/theaterCelebration";
import type { Side } from "../models";
import { decisive, type LiveMoment } from "../moments";
import { parse, type FootballScene, type FootballTheaterState } from "./footballScene";
import type { FootballScript, Rest } from "./footballScript";

// MARK: - The field between plays

/** The live situation as the field between plays: the spot and line to gain in the offense's yards (the top team attacks the right end zone). */
export function footballRest(situation: Football): { rest: Rest; offense: Side } | null {
  const side = situation.possession;
  if (!side) return null;
  const yard = (x: number) => (side === "top" ? x : 100 - x);
  return { rest: { yard: yard(situation.ballX), gain: situation.lineToGainX != null ? yard(situation.lineToGainX) : null }, offense: side };
}

/** With no situation at all: the offense at its 25, ten to go. */
export const DEFAULT_REST: Rest = { yard: 25, gain: 35 };

// MARK: - What the theater shows

/** How long ago a play may have happened and still be news on a page that just opened (BaseballFeed.recent). */
export const RECENT_MS = 60_000;

/**
 * The theater after a look at the plays. Its snap is news if it arrived
 * after the first complete look, or if it only just happened (a page opened
 * right after it); otherwise it's history, shown as it ended. A snap already
 * showing keeps what it was, edits and all. (FootballFeed.theater; pure)
 */
export function footballTheaterState(scene: FootballScene, previous: FootballTheaterState, primed: boolean, now: number): FootballTheaterState {
  return {
    play: scene,
    news: scene.id === previous.play?.id ? previous.news : primed || (scene.wallclock != null && now - scene.wallclock < RECENT_MS),
  };
}

const sequenceOf = (item: JSONValue): number => {
  const s = str(at(item, "sequenceNumber"));
  const n = s != null ? Number(s) : num(at(item, "sequenceNumber"));
  return n != null && Number.isFinite(n) ? n : 0;
};

/**
 * The lane's theater, kept beside the lane (FootballFeed's `theater` and
 * `theaterSequence`): given the lane's raw entries in play order after each
 * change, the newest entry at or after the theater's snap that is one
 * becomes the theater's snap. An entry ESPN edited is a new object in the
 * lane's list; an unchanged one is the same object, so it changes nothing.
 */
export class FootballTheaterWatch {
  state: FootballTheaterState = { play: null, news: false };
  /** The sequence number of the theater's snap: an older entry never replaces it. */
  private sequence = -1;
  private item: JSONValue = undefined;
  private items: readonly JSONValue[] | null = null;

  /** `primed`: the lane had a complete look before this change. True when the state changed. */
  update(items: readonly JSONValue[], teams: FootballTeams, primed: boolean, now: number = Date.now()): boolean {
    if (items === this.items) return false;
    this.items = items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const sequence = sequenceOf(item);
      if (sequence < this.sequence) break;
      if (item === this.item) return false;
      const scene = parse(item, teams);
      if (!scene) continue;
      this.sequence = sequence;
      this.item = item;
      this.state = footballTheaterState(scene, this.state, primed, now);
      return true;
    }
    return false;
  }
}

// MARK: - Celebration

/** A burst on the theater's stage, in whose colors. */
export interface FootballBurst extends TheaterBurst {
  /** Whose colors it wears. */
  readonly side: Side | null;
}

const DEG = Math.PI / 180;

/**
 * One celebration per moment, and the theater owns its plays' when the page
 * shows it (the drive chart keeps its marks and bursts nothing): a
 * touchdown's fireworks over the goal line it crossed with confetti off the
 * banner, a pick six's at the maximum, a field goal's small pop at the
 * crossbar, a big play's sparks where he was stopped. Turnovers, a safety
 * and fourth down get their banner alone. Every burst goes through the
 * page's rules (`cueFor`): the celebration level, Reduce Motion, and one
 * particle burst every 10 s. (pure; tested)
 */
export const FootballCelebration = {
  /** The drive chart bursts only when there's no theater to. */
  driveChartBursts(theaterShown: boolean): boolean {
    return !theaterShown;
  },

  /** The theater's bursts for this play's moment, in script time. Nothing for another play's moment, or when the level is Off. */
  theater(moment: LiveMoment | null, play: FootballScene, script: FootballScript, level: CelebrationLevel, reduceMotion: boolean, height: number): FootballBurst[] {
    if (!moment || moment.id !== play.id || moment.chart !== "field") return [];
    const gold = decisive(moment);
    const cue = (effects?: readonly Effect[]): CelebrationCue | null => {
      const c = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: 90 * DEG, effects });
      return c && gold ? { ...c, gold: true } : c;
    };
    const scale = Math.max(2.2, height / 95);
    const bursts: FootballBurst[] = [];
    switch (moment.kind) {
      case "touchdown": {
        const at = script.score;
        const point = script.scorePoint;
        if (at == null || !point) return [];
        // The shells burst over the goal line as the ball crosses: two, three for a pick six or a game-winner.
        const shells = play.pickSix || decisive(moment) ? 3 : 2;
        const fireworks = cue([{ kind: "fireworks", shells }]);
        if (fireworks) bursts.push({ cue: fireworks, at: at - fireworks.delay, anchor: { kind: "field", point: { x: point.x, y: point.y, z: 24 } }, scale, side: play.scorer });
        // The banner's confetti: only ever confetti (Subtle, the cooldown and Reduce Motion leave the banner alone).
        if (script.banner?.confetti) {
          const confetti = cue([{ kind: "confetti", direction: 90 * DEG, spread: (play.pickSix ? 170 : 150) * DEG, preset: "medium" }]);
          if (confetti && confetti.effects.some((e) => e.kind === "confetti")) {
            bursts.push({ cue: confetti, at: at + 0.12 - confetti.delay, anchor: { kind: "banner" }, scale: scale * (play.pickSix ? 0.85 : 0.7), side: play.scorer });
          }
        }
        break;
      }
      case "fieldGoal": {
        // A small pop at the crossbar as the ball goes over it.
        const at = script.score;
        const point = script.scorePoint;
        const pop = cue();
        if (at == null || !point || !pop) return [];
        bursts.push({ cue: pop, at: at - pop.delay, anchor: { kind: "field", point }, scale: scale * 0.8, side: play.scorer });
        break;
      }
      case "passComplete":
      case "rush": {
        const end = script.end;
        if (!moment.accents.has("bigPlay") || !end) return [];
        const sparks = cue();
        if (!sparks) return [];
        bursts.push({ cue: sparks, at: script.stamp - 0.1 - sparks.delay, anchor: { kind: "field", point: { x: end.x, y: end.y, z: 4 } }, scale: scale * 0.7, side: play.offense });
        break;
      }
      default:
        // Turnovers, a safety, a miss, fourth down: the banner alone.
        break;
    }
    return bursts;
  },
};
