/**
 * What a replay well asks of its sport (ReplayWell.swift's `ReplayTake` and
 * its frames): each sport's takes, scripted as its live theater scripts
 * them (its own chunk: mlb/theater/replayPlate.ts, football/theater/
 * replayField.ts, nba/theater/replayCourt.ts, soccer/theater/replayPitch.ts),
 * and how one of them is drawn at an instant, with its stamp, celebration
 * and names. The well (ReplayWell.tsx) owns time; the sport only draws.
 */
import type { CelebrationLevel } from "../../../../data/celebrations";
import type { PlayReplay, ReplayContext, ReplayScene } from "../../../../data/replays";
import type { Scheme } from "../../../../data/teamColors";
import type { Bloom } from "../theater/TheaterStage";
import type { Ctx, Size, StageBurst } from "../theater/theaterKit";
import type { TheaterNames } from "../theater/useTheaterNames";

/** How the page looks and moves: what a replay's colors, turn of the field and celebration answer. */
export interface ReplayLook {
  readonly scheme: Scheme;
  /** The viewer's turn of the field for this game (the live theater's; only read here). */
  readonly flipped: boolean;
  readonly level: CelebrationLevel;
  readonly reduceMotion: boolean;
}

/** The broadcast tag at an instant (football's and soccer's say what's happening; a replay's headline and mark say the rest). */
export interface ReplayStatus {
  readonly tag: string | null;
  /** A team's color (hex without the hash), or null for the game's own. */
  readonly tint: string | null;
}

export const NO_STATUS: ReplayStatus = { tag: null, tint: null };

/** One replay as its sport draws it, its takes scripted. */
export interface ReplayDrawing {
  /** Each take's script length (the running order: ReplayClock). */
  readonly lengths: readonly number[];
  /**
   * The time a take holds at once played through: how the live theater
   * draws a play that has ended (Infinity); a basketball replay's last
   * frame, where everyone still stands (its men fade out by Infinity).
   */
  ended(take: number): number;
  /** The corner the live theater keeps its heartbeat in: the replay control's. */
  readonly corner: "leading" | "trailing";
  status(take: number, t: number): ReplayStatus;
  /**
   * One frame: take `take` at its time `t`, the names over it (`names`, held
   * outside React), and the first take's bursts at `elapsed` seconds into
   * the replay (its celebration runs from when it began).
   */
  paint(ctx: Ctx, size: Size, pt: number, take: number, t: number, elapsed: number, bursts: readonly StageBurst[], names: TheaterNames): void;
  /** The play's bursts for its moment, at this stage height (the first take's, in its time). */
  bursts(height: number): readonly StageBurst[];
  /** Reduce Motion's end state for the moment: a bloom where it happened, or null. */
  bloom(size: Size): Bloom | null;
}

/** A sport's replays: its takes (pure; tested), and a replay of them as drawn in a look. */
export interface ReplaySport<Take> {
  takes(scene: ReplayScene, flipped: boolean, context: ReplayContext): readonly Take[];
  drawing(takes: readonly Take[], replay: PlayReplay, context: ReplayContext, look: ReplayLook): ReplayDrawing;
}

/** A team's color for the tag, as hex without the hash (the kit's own, else none). */
export const tagColor = (color: string | null | undefined): string | null => (color ? color.replace(/^#/, "") : null);

/** A layout cached per take and size (the type is laid out once per play and size). */
export function perTake<T>(make: (take: number, ctx: CanvasRenderingContext2D, size: Size, pt: number) => T): (take: number, ctx: CanvasRenderingContext2D, size: Size, pt: number) => T {
  const cache = new Map<number, { key: string; value: T }>();
  return (take, ctx, size, pt) => {
    const key = `${size.width}x${size.height}|${pt}`;
    const hit = cache.get(take);
    if (hit?.key === key) return hit.value;
    const value = make(take, ctx, size, pt);
    cache.set(take, { key, value });
    return value;
  };
}
