/**
 * The basketball theater's running order and what it says
 * (BasketballFlow.swift). Every play the live lane brings is told in order
 * (`basketballNext`): a marquee play as its full replay, the rest as their
 * lighter beats, a miss with the rebound it ended in, the substitutions at
 * one stoppage together. Live plays come every few seconds; the theater
 * never falls more than a dozen seconds of telling behind the game: when
 * plays pile up, the least of them (a substitution, a timeout that's over,
 * a whistle) are passed over, never a replay nor the newest, and the tag
 * says so (CATCHING UP · 3 PLAYS).
 *
 * Between plays the court rests on the state the last play left
 * (`restAfter`), and the broadcast tag (`statusBetween`, `statusDuring`)
 * says what's going on: whose ball it is in the team's color, or the
 * stoppage the game is in (TIMEOUT · JAZZ, END OF 3RD, HALFTIME, CHALLENGE ·
 * SPURS). ESPN doesn't flag TV breaks: timeouts and the ends of periods are
 * the honest ones, and "MEDIA TIMEOUT" only when its words say so. Pure;
 * tested.
 *
 *     const unit = basketballNext(cursor, told, state);
 */
import type { Side } from "../models";
import { restOf, stoppageWords, type HoopsEnds, type Lineup, type Phase, type RestSpec } from "./basketballBeats";
import { afterSide, ballSide, replays, type BasketballScene, type BasketballTheaterState, type Rebound } from "./basketballScene";
import type { BasketballScript } from "./basketballScript";

// MARK: - The running order

/**
 * One thing to tell: a play; the substitutions at one stoppage told with it
 * (`group`, the first is `scene`); the plays its telling covers (later ones
 * its choreography shows: a miss's rebound, an offensive foul's turnover;
 * earlier ones a replay tells again: a putback's miss; the ones passed
 * over); how many were passed over just before it, to keep up with the game.
 */
export interface BasketballUnit {
  readonly scene: BasketballScene;
  readonly group: readonly BasketballScene[];
  readonly covers: readonly string[];
  readonly skipped: number;
}

export const isMarquee = (u: BasketballUnit) => replays(u.scene);

/** Never more than this many seconds of telling behind the game. */
export const QUEUE_BUDGET = 12;

/** How long a play takes to tell, about: a replay's full length, a beat's second or three. */
export function estimate(scene: BasketballScene): number {
  if (replays(scene)) return 6.5;
  switch (scene.kind) {
    case "jumper":
    case "three":
    case "layup":
    case "dunk":
    case "alleyOop":
    case "putback":
    case "block":
      return 3.8;
    case "freeThrow":
      return 3.2;
    case "offensiveRebound":
    case "defensiveRebound":
      return 1.8;
    case "steal":
    case "turnover":
      return 2.4;
    case "foul":
    case "violation":
    case "challenge":
      return 2.2;
    case "jumpBall":
      return 2.6;
    case "substitution":
      return 1.6;
    case "timeout":
    case "periodEnd":
      return 2.0;
  }
}

/** What's passed over first when it's behind: a substitution or a stoppage that's over, then a whistle or a board, then a shot or a turnover; never a replay. */
export function priority(scene: BasketballScene): number {
  if (replays(scene)) return 9;
  switch (scene.kind) {
    case "substitution":
    case "timeout":
    case "challenge":
    case "periodEnd":
      return 0;
    case "offensiveRebound":
    case "defensiveRebound":
    case "foul":
    case "violation":
    case "jumpBall":
      return 1;
    default:
      return 2;
  }
}

/** What to tell next: the first play that's news after the last one told (`cursor`; `told`, everything told or covered so far), grouped and caught up. Null when there's nothing new. (pure; tested) */
export function basketballNext(cursor: string | null, told: ReadonlySet<string>, state: BasketballTheaterState): BasketballUnit | null {
  const plays = state.plays;
  let from = 0;
  const at = cursor != null ? lastIndexOf(plays, (p) => p.id === cursor) : -1;
  if (at >= 0) from = at + 1;
  else {
    const last = lastIndexOf(plays, (p) => told.has(p.id));
    if (last >= 0) from = last + 1;
  }
  const pending = plays.slice(Math.min(from, plays.length)).filter((p) => state.news.has(p.id) && !told.has(p.id));
  if (pending.length === 0) return null;
  const ids = new Set(pending.map((p) => p.id));
  // A steal, a miss and its board that a replay to come tells again aren't told twice.
  const retold = new Set(pending.filter(replays).flatMap((p) => p.leadIn));
  const units: { scene: BasketballScene; group: BasketballScene[]; covers: string[] }[] = [];
  const covered = new Set<string>();
  let i = 0;
  while (i < pending.length) {
    const play = pending[i]!;
    i += 1;
    if (covered.has(play.id) || retold.has(play.id)) continue;
    const group: BasketballScene[] = [];
    if (play.kind === "substitution") {
      group.push(play);
      while (i < pending.length && pending[i]!.kind === "substitution") {
        group.push(pending[i]!);
        i += 1;
      }
    }
    const later = play.follows.filter((id) => ids.has(id));
    const covers = [...later, ...(replays(play) ? play.leadIn.filter((id) => ids.has(id)) : []), ...group.slice(1).map((g) => g.id)];
    for (const id of later) covered.add(id);
    units.push({ scene: play, group, covers });
  }
  if (units.length === 0) return null;
  // Behind: pass over the least of it, oldest first; never a replay, never the newest.
  let total = units.reduce((sum, u) => sum + estimate(u.scene), 0);
  const dropped = new Set<number>();
  if (total > QUEUE_BUDGET) {
    const order = units
      .slice(0, -1)
      .map((_, k) => k)
      .sort((a, b) => priority(units[a]!.scene) - priority(units[b]!.scene) || a - b);
    for (const k of order) {
      if (!(total > QUEUE_BUDGET) || replays(units[k]!.scene)) continue;
      dropped.add(k);
      total -= estimate(units[k]!.scene);
    }
  }
  const first = units.findIndex((_, k) => !dropped.has(k));
  if (first < 0) return null;
  const unit = units[first]!;
  const passed = units.slice(0, first);
  const skipped = passed.reduce((n, u) => n + Math.max(u.group.length, 1), 0);
  let covers = [...unit.covers, ...passed.flatMap((u) => [u.scene.id, ...u.covers])];
  // Retold lead-ins ride with their replay.
  if (replays(unit.scene)) covers = [...covers, ...unit.scene.leadIn.filter((id) => ids.has(id))];
  return { scene: unit.scene, group: unit.group, covers, skipped };
}

function lastIndexOf<T>(list: readonly T[], match: (t: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i]!)) return i;
  return -1;
}

// MARK: - The court after a play

const opponent = (side: Side | null): Side | null => (side === "top" ? "bottom" : side === "bottom" ? "top" : null);

/**
 * The court once a play's been told: who has the ball and how the floor got
 * that way (a score: the ball in from under the basket; a defensive board or
 * a steal: up the floor the other way; a shooting foul: to the lane; a
 * timeout: the benches; the half: off the floor). A substitution or a review
 * keeps the floor as it was. (pure; tested)
 */
export function restAfter(scene: BasketballScene | null, previous: RestSpec | null, lineup: Lineup | null, ends: HoopsEnds, possession: Side | null): RestSpec {
  const keep = previous?.offense ?? possession;
  if (!scene) return restOf({ offense: possession, ends, phase: possession == null ? "tip" : "live", from: lineup });
  const make = (offense: Side | null, phase: Phase, outlet = false): RestSpec => restOf({ offense, ends, phase, from: lineup, seed: scene.id, outlet });
  /** A big who takes a defensive board outlets it (a guard brings it up himself). */
  const outlet = (r: Rebound) => !r.offensive && r.person?.role != null && r.person.role !== "guard";
  switch (scene.kind) {
    case "jumper":
    case "three":
    case "layup":
    case "dunk":
    case "alleyOop":
    case "putback":
    case "block": {
      if (scene.result === "make") return scene.andOne ? make(scene.offense, "lane") : make(opponent(scene.offense), "inboundBaseline");
      const r = scene.rebound;
      if (!r) return make(scene.offense, "loose");
      return make(r.offensive ? scene.offense : opponent(scene.offense), r.person == null ? "inboundSideline" : "live", outlet(r));
    }
    case "freeThrow": {
      const last = (scene.attempt ?? 1) >= (scene.attempts ?? 1);
      if (!last) return make(scene.offense, "lane");
      if (scene.result === "make") return make(opponent(scene.offense), "inboundBaseline");
      const r = scene.rebound;
      if (!r) return make(scene.offense, "loose");
      return make(r.offensive ? scene.offense : opponent(scene.offense), r.person == null ? "inboundSideline" : "live", outlet(r));
    }
    case "offensiveRebound":
    case "defensiveRebound":
      return make(scene.offense, scene.shooter == null ? "inboundSideline" : "live", scene.kind === "defensiveRebound" && scene.shooter?.role != null && scene.shooter.role !== "guard");
    case "steal":
      return make(opponent(scene.offense), "live");
    case "turnover": {
      const live = scene.call?.kind === "lostBall" || scene.call?.kind === "badPass";
      return make(opponent(scene.offense), live ? "live" : "inboundSideline");
    }
    case "foul":
    case "violation": {
      const c = scene.call;
      if (!c || c.kind === "technical" || c.kind === "delay") return make(keep, previous?.phase ?? "live");
      if (c.kind === "goaltending") return make(scene.offense, "inboundBaseline");
      if (["shooting", "personal", "looseBall", "take", "flagrant", "kickedBall"].includes(c.kind)) {
        const shots = c.kind === "shooting" || scene.trip != null;
        return make(opponent(scene.offense), shots ? "lane" : "inboundSideline");
      }
      return make(opponent(scene.offense), "inboundSideline");
    }
    case "jumpBall":
      return make(scene.offense, "live");
    case "timeout":
      return make(keep, "benches");
    case "periodEnd":
      return make(null, scene.final || scene.period === 2 ? "offCourt" : "benches");
    case "substitution":
    case "challenge": {
      let phase = previous?.phase ?? "live";
      if (phase === "inboundBaseline" || phase === "inboundSideline") phase = "live";
      return make(keep, phase);
    }
  }
}

// MARK: - What it says

/** "END OF 1ST", "HALFTIME", "END OF 3RD", "END OF REGULATION" (tied after four: overtime to come), "END OF OT", "END OF 2OT", "FINAL". */
export function periodWords(period: number, final: boolean, tied: boolean): string {
  if (final) return "FINAL";
  switch (period) {
    case 1:
      return "END OF 1ST";
    case 2:
      return "HALFTIME";
    case 3:
      return "END OF 3RD";
    case 4:
      return tied ? "END OF REGULATION" : "END OF 4TH";
    default:
      return period === 5 ? "END OF OT" : `END OF ${period - 4}OT`;
  }
}

/** A review's words: "CHALLENGE · JAZZ", then its ruling ("· OVERTURNED", "· CALL STANDS"); a referees' review is just "REVIEW". */
export function reviewWords(scene: BasketballScene, team: string | null): string {
  const who = scene.review ? null : (team ?? /\[(.+?)\]/.exec(scene.text)?.[1]?.toUpperCase() ?? null);
  const ruling = scene.overturned == null ? null : scene.overturned ? "OVERTURNED" : "CALL STANDS";
  return [scene.review ? "REVIEW" : "CHALLENGE", who, ruling].filter((w): w is string => w != null).join(" · ");
}

/** A tag: its words and whose color. */
export interface Said {
  readonly text: string;
  readonly side: Side | null;
}

/**
 * The tag between plays: the stoppage the game is in (the last play told
 * that wasn't a substitution: a timeout, the end of a period, a challenge
 * still under review), else whose ball it is ("SPURS BALL", "FREE THROWS ·
 * SPURS" on the lane); nothing while a miss is loose.
 */
export function statusBetween(context: BasketballScene | null, rest: RestSpec | null, names: { readonly top: string; readonly bottom: string }): Said | null {
  if (context) {
    switch (context.kind) {
      case "timeout":
        return { text: stoppageWords(context), side: context.stoppage == null ? context.offense : null };
      case "periodEnd":
        return { text: periodWords(context.period ?? 1, context.final, context.top === context.bottom), side: null };
      case "challenge":
        if (context.overturned == null) return { text: reviewWords(context, null), side: context.offense };
        break;
      default:
        break;
    }
  }
  const side = rest?.offense;
  if (!rest || side == null) return null;
  const name = (side === "top" ? names.top : names.bottom).toUpperCase();
  if (name === "") return null;
  switch (rest.phase) {
    case "loose":
    case "tip":
    case "offCourt":
      return null;
    case "lane":
      return { text: `FREE THROWS · ${name}`, side };
    default:
      return { text: `${name} BALL`, side };
  }
}

/** The tag while something's told: the beat's own (its whistle's, from when it blows), the catching up for its first moments, else whose ball it is; nothing over a replay (its banner and stamp say it). */
export function statusDuring(unit: BasketballUnit, script: BasketballScript, t: number, names: { readonly top: string; readonly bottom: string }): Said | null {
  if (unit.skipped > 0 && t < 1.6) return { text: `CATCHING UP · ${unit.skipped} PLAY${unit.skipped === 1 ? "" : "S"}`, side: null };
  if (replays(unit.scene)) return null;
  const tag = script.tag;
  if (tag && t >= tag.at) return { text: tag.text, side: tag.side };
  let side = ballSide(unit.scene);
  // A play that turns the ball over says so as it lands (the board, the steal).
  const after = afterSide(unit.scene);
  if (Number.isFinite(script.stamp) && t >= script.stamp - 0.2 && after != null) side = after;
  if (side == null) return null;
  const name = (side === "top" ? names.top : names.bottom).toUpperCase();
  return name === "" ? null : { text: `${name} BALL`, side };
}
