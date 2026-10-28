/**
 * The soccer theater's pure parts (SoccerTheater.swift, and LiveFeeds.swift
 * `SoccerFeed.theater`): the broadcast camera's perspective through a
 * framing, the stamp's second line, the caption's sentences, who
 * celebrates what (`GoalCelebration`), and what the theater shows from the
 * live lane (`SoccerTheaterWatch`, the lane's `updateTheater` kept outside
 * the lane). The drawing is features/game/soccer/theater.
 */
import { cueFor, presetFor, sparks, cueDuration, type CelebrationCue, type CelebrationLevel, type Effect } from "../celebrations";
import type { JSONValue } from "../json";
import { pitchScale, type PitchScale } from "../liveFeeds/soccer";
import { decisive, type LiveMoment } from "../moments";
import { CameraFrame } from "../mlb/playCamera";
import type { FieldPoint, Point } from "../mlb/theaterField";
import { attacksRight, goalOf, isMoment, keepers, parse, Pitch, playID, scored, type SoccerScene, type SoccerTheaterState } from "./soccerScene";
import { pitchBursts, theaterOwns } from "./goalCelebrationRules";
import { PitchCamera, PitchFrame, type Basis, type SoccerScript } from "./soccerScript";
import { TheaterBurst } from "./theaterKit";

export { stampDetail } from "./soccerScene";

// MARK: - Projection

/** The broadcast camera's perspective through a framing, filling the view. */
export class PitchProjection {
  readonly size: { readonly width: number; readonly height: number };
  readonly camera: PitchFrame;
  readonly basis: Basis;
  /** Points per unit of the view's tangent plane. */
  readonly focal: number;

  constructor(size: { readonly width: number; readonly height: number }, camera: PitchFrame = PitchFrame.rest) {
    this.size = size;
    this.camera = camera;
    this.basis = PitchCamera.basis(camera.camera, camera.angle);
    const half = Math.max(camera.camera.span, 1) / 2 / this.basis.distance;
    this.focal = Math.max(Math.min(size.height / 2 / half, size.width / 2 / (half * CameraFrame.aspect)), 1);
  }

  /** Behind which goal the camera is (null: the main camera, in the stand). */
  get behind(): boolean | null {
    return this.camera.angle.kind === "behind" ? this.camera.angle.right : null;
  }

  /** How far a point is from the lens, along its axis: what's further is drawn first. */
  depth(p: FieldPoint): number {
    const { eye, forward } = this.basis;
    return (p.x - eye.x) * forward.x + (p.y - eye.y) * forward.y + (p.z - eye.z) * forward.z;
  }

  point(p: FieldPoint): Point {
    const t = this.basis.tangent(p);
    return { x: this.size.width / 2 + t.u * this.focal, y: this.size.height / 2 - t.v * this.focal };
  }

  pointGround(p: Point, z = 0): Point {
    return this.point({ x: p.x, y: p.y, z });
  }

  /** Points per metre at a spot's distance from the lens. */
  scale(p: FieldPoint): number {
    const { eye, forward } = this.basis;
    return this.focal / Math.max((p.x - eye.x) * forward.x + (p.y - eye.y) * forward.y + (p.z - eye.z) * forward.z, 0.5);
  }

  /** A standing figure's height in points: a little larger than life, smaller further off, never a speck, never a giant. */
  figure(p: Point): number {
    const h = this.size.height;
    return Math.min(Math.max(2.5 * this.scale({ x: p.x, y: p.y, z: 0 }), Math.max(9, h * 0.06)), Math.max(h * 0.2, 10));
  }
}

// MARK: - Caption

/** ESPN runs a note onto the end of a sentence ("…with a cross.Goal confirmed following VAR Review."): a space between them. */
export function sentences(text: string): string {
  return text.replace(/\.(?=\p{Lu})/gu, ". ");
}

// MARK: - Celebration

/** A burst on the theater's stage. */
export interface Burst {
  readonly cue: CelebrationCue;
  /** Script time it mounts (its cue's own delay comes after). */
  readonly at: number;
  /** A point on the pitch (it moves with the camera), or under the headline. */
  readonly anchor: { readonly kind: "field"; readonly point: FieldPoint } | { readonly kind: "banner" };
  /** Larger than the charts' bursts: the theater is the stage. */
  readonly scale: number;
}

export const burstEnd = (b: Burst): number => b.at + cueDuration(b.cue);

/**
 * One celebration per moment, and the theater owns the ones it replays when
 * the page shows it: a goal's fireworks burst over the net it went into,
 * with confetti off the headline (the Live Pitch only draws the shot's path);
 * a save's glint in the keeper's hands; sparks off the post. Every burst
 * goes through the page's rules (`cueFor`): the celebration level, Reduce
 * Motion, and one particle burst every 10 s. (pure; tested)
 */
export const GoalCelebration = {
  /** The moments the theater replays (and so celebrates): goals, saves, blocks, the woodwork, big chances. Cards stay the Live Pitch's. */
  theaterOwns,

  /** The Live Pitch bursts over a moment only when there's no theater to. */
  pitchBursts,

  /**
   * The theater's bursts for this moment, in script time: fireworks over
   * the net as a goal goes in (three, in gold, for a late winner or
   * equalizer) and the headline's confetti; a save's glint; the post's
   * sparks. Nothing for another moment, or when the level is Off.
   */
  theater(moment: LiveMoment | null, scene: SoccerScene, script: SoccerScript, level: CelebrationLevel, reduceMotion: boolean, height: number): Burst[] {
    if (!moment || moment.id !== scene.id || moment.chart !== "pitch") return [];
    const gold = scene.decisive || decisive(moment);
    const cue = (effects: readonly Effect[]): CelebrationCue | null => {
      const c = cueFor(moment, { level, reduceMotion, preset: presetFor(height), direction: Math.PI / 2, effects });
      return c && gold && scored(scene) ? { ...c, gold: true } : c;
    };
    const scale = TheaterBurst.scale(height);
    const bursts: Burst[] = [];
    const side = attacksRight(scene) ? 1.0 : -1.0;
    const net = script.impacts.find((i) => i.kind === "net");
    const hit = script.impacts.find((i) => i.kind === "save" || i.kind === "woodwork");
    if (scored(scene) && net) {
      const fireworks = cue([{ kind: "fireworks", shells: gold ? 3 : 2 }]);
      if (fireworks) {
        // Just over the net it went into.
        const over = { x: goalOf(scene).x + side * 1.5, y: Pitch.width / 2, z: 5.5 };
        bursts.push({ cue: fireworks, at: net.at - fireworks.delay, anchor: { kind: "field", point: over }, scale });
      }
      const banner = script.banners.find((b) => b.confetti);
      const confetti = banner ? cue([{ kind: "confetti", direction: Math.PI / 2, spread: (150 * Math.PI) / 180, preset: "medium" }]) : null;
      if (banner && confetti && confetti.effects.some((e) => e.kind === "confetti")) {
        bursts.push({ cue: confetti, at: banner.at + 0.1 - confetti.delay, anchor: { kind: "banner" }, scale: scale * 0.7 });
      }
    } else if (hit && (scene.outcome === "saved" || scene.outcome === "woodwork")) {
      const glint = cue([sparks(6, 11)]);
      if (glint) bursts.push({ cue: glint, at: hit.at - glint.delay, anchor: { kind: "field", point: hit.point }, scale: scale * 0.6 });
    }
    return bursts;
  },
};

// MARK: - What the theater shows

/** BaseballFeed.recent: a moment this fresh is news even on a page that only just opened (ESPN posts plays late). */
/**
 * What the stage shows (SoccerTheater.swift `SoccerTheater.shown`): a
 * moment replaying, then its end (the scorer wheeling away, the stamp) until
 * it has held (`rested`); a new moment not yet begun; otherwise null, the
 * quiet pitch. History that isn't news is never shown: moments can be twenty
 * minutes apart, and on opening the page the pitch is quiet. (pure; tested)
 */
export function soccerShown(state: SoccerTheaterState, replaying: string | null, rested: string | null): SoccerScene | null {
  const scene = state.scene;
  if (!scene) return null;
  if (replaying === scene.id) return rested === scene.id ? null : scene;
  return state.news ? scene : null;
}

export const RECENT_MS = 60_000;

/**
 * The theater after a look at a moment (SoccerFeed.theater). It's news if it
 * arrived after the first complete load, or if it only just happened (a page
 * opened right after it); otherwise it's history, shown as it ended. A
 * moment already showing keeps what it was. (pure; tested)
 */
export function soccerTheaterState(scene: SoccerScene, previous: SoccerTheaterState, primed: boolean, now: number): SoccerTheaterState {
  const news = scene.id === previous.scene?.id ? previous.news : primed || (scene.wallclock != null && now - scene.wallclock < RECENT_MS);
  return { scene, news };
}

/**
 * The lane's `updateTheater` (LiveFeeds.swift `SoccerFeed`), outside the
 * lane: it follows the web lane's window of raw core plays
 * (`SoccerFeed.plays`, data/liveFeeds/soccer.ts) and parses a moment only
 * when one has arrived (or the one showing has been followed by its save or
 * block), with the plays before it. The lane trims its window to the newest
 * 80 and keeps each play's object, so what's new is what follows the last
 * window's newest play. (The Mac parses from the old window plus the new
 * plays, untrimmed: a batch of more than 80 is the only difference.)
 *
 *     const watch = new SoccerTheaterWatch();
 *     if (watch.update(feed.plays, homeID, wasLoaded)) render(watch.state);
 */
export class SoccerTheaterWatch {
  state: SoccerTheaterState = { scene: null, news: false };
  /** Goalkeepers by team ID, as the plays reveal them. */
  private keepers: Record<string, string> = {};
  /** The newest play of the window last seen. */
  private newest: JSONValue | undefined = undefined;
  private scale: PitchScale | null = null;

  /** After a change to the lane's window. `primed`: the lane had a complete load before this change. Returns whether `state` changed. */
  update(window: readonly JSONValue[], homeTeamID: string | null, primed: boolean, now: number = Date.now()): boolean {
    let first = 0;
    if (this.newest !== undefined) {
      const i = window.lastIndexOf(this.newest);
      first = i >= 0 ? i + 1 : 0;
    }
    const fresh = window.slice(first);
    if (fresh.length === 0) return false;
    this.newest = window[window.length - 1];
    this.scale ??= pitchScale(window);
    Object.assign(this.keepers, keepers(fresh));
    const index = window.findLastIndex((p) => isMoment(p));
    if (index < 0) return false;
    if (!(index >= first || (index >= first - 6 && playID(window[index]) === this.state.scene?.id))) return false;
    const scene = parse(window, index, homeTeamID, this.keepers, this.scale ?? "percent");
    if (!scene) return false;
    const next = soccerTheaterState(scene, this.state, primed, now);
    if (sameState(next, this.state)) return false;
    this.state = next;
    return true;
  }
}

/** `SoccerTheaterState ==`: the same moment, as parsed, and the same news. */
function sameState(a: SoccerTheaterState, b: SoccerTheaterState): boolean {
  return a.news === b.news && JSON.stringify(a.scene) === JSON.stringify(b.scene);
}
