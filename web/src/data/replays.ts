/**
 * Click a play, watch it (Replays.swift): the game page's plays (the plays
 * list, key moments, the scoring list) replayed in the isometric view under
 * the row clicked, live or after the game (features/game/core/replay/
 * draws it).
 *
 * Each play's scene is built the way the sport's live theater builds it, by
 * the same builders, from what the page already has: the summary's plays
 * (baseball), the soccer lane's moments, the live lanes' entries. What a
 * finished game is missing (football's and basketball's core plays, MLB's
 * account) is fetched once, when the page opens, and kept for the game;
 * nothing polls. A play replays only when the live theater would replay it
 * in full: a baseball play on the field, a football snap or kick, a
 * basketball shot worth its own replay (`BasketballScene.replays`), a soccer
 * shot or goal. Beats between them (a pitch, a card, a timeout) aren't
 * replays, and their rows stay as they are.
 *
 * The replay is its own instance: the theater above, on a live game, never
 * hears of it (its queue, what it has played, its turn of the field).
 *
 * This module is the light half every page loads (which row is open, the
 * running order, which plays a page's rows are about). The builders, which
 * read plays with the theaters' parsers, are `replayReaders.ts`, loaded
 * when a page first has something to read, so a page's chunk never carries
 * a parser.
 */
import { at, int, num, str, type JSONValue } from "./json";
import { matchColors, type MatchColors } from "./matchColors";
import type { Competitor, ScoreEvent, Side } from "./models";
import type { LiveMoment } from "./moments";
import type { PlayScene } from "./mlb/playScene";
import type { Rest } from "./mlb/playScript";
import type { BaseballFielders } from "./mlb/fielders";
import type { BasketballScene } from "./theater/basketballScene";
import type { FootballScene } from "./theater/footballScene";
import type { SoccerScene } from "./theater/soccerScene";
import type { TheaterPerson } from "./theater/theaterPeople";
import type { TeamPalette } from "./teamColors";
import type { Section } from "./sections";

/** A play's scene, ready for its sport's script (PlayReplay.Scene). */
export type ReplayScene =
  /** The play, and the field it leaves. */
  | { readonly kind: "baseball"; readonly play: PlayScene; readonly rest: Rest }
  /** A snap or kick (a touchdown's try follows it, as live). */
  | { readonly kind: "football"; readonly scene: FootballScene }
  | { readonly kind: "basketball"; readonly scene: BasketballScene }
  | { readonly kind: "soccer"; readonly scene: SoccerScene };

/**
 * A play a row can replay: its scene, ready for the sport's script, and its
 * moment as the live lane would have offered it (what its celebration answers).
 */
export interface PlayReplay {
  readonly scene: ReplayScene;
  readonly moment: LiveMoment | null;
}

/** A page's replays by ESPN play ID. */
export type Replayable = Readonly<Record<string, PlayReplay>>;

/**
 * A replay's value as text: two that read the same are the same replay (the
 * Swift compares them as values; a page reading its plays again keeps the
 * one already built, so an open well doesn't start over).
 */
export function replayValue(replay: PlayReplay): string {
  return JSON.stringify(replay, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
}

/** A row on the page: its list, and the play it's about (a play can be in two lists). */
export interface ReplayRow {
  readonly section: Section;
  readonly play: string;
}

export const sameRow = (a: ReplayRow | null, b: ReplayRow | null): boolean => a === b || (a != null && b != null && a.section === b.section && a.play === b.play);

/**
 * Which row is open: one at a time. Opening another closes the first; the
 * open one, clicked again (or Esc), closes; a row whose play can't replay
 * any more (edited away) closes. (pure; tested)
 */
export class ReplayOpening {
  constructor(readonly row: ReplayRow | null = null) {}

  toggle(next: ReplayRow): ReplayOpening {
    return new ReplayOpening(sameRow(this.row, next) ? null : next);
  }

  /** Closed, and whether there was a row to close. */
  close(): { readonly opening: ReplayOpening; readonly closed: boolean } {
    return { opening: new ReplayOpening(null), closed: this.row != null };
  }

  keep(replayable: (play: string) => boolean): ReplayOpening {
    return this.row && !replayable(this.row.play) ? new ReplayOpening(null) : this;
  }
}

/**
 * A replay's running order: each take after the one before (a touchdown,
 * then its try a breath after, as the live theater follows it), then the
 * last one held as it ended. (pure; tested)
 */
export class ReplayClock {
  /** The live theater's breath before a touchdown's try. */
  static readonly breath = 0.3;

  /** Each take's script length. */
  constructor(readonly lengths: readonly number[]) {}

  /** When the last take ends. */
  get end(): number {
    return this.lengths.reduce((a, b) => a + b, 0) + Math.max(this.lengths.length - 1, 0) * ReplayClock.breath;
  }

  /**
   * The take on screen `elapsed` seconds in, and its time (a take's
   * formation stands through the breath before it, at a time below zero);
   * from the end, the last take as it ended (Infinity).
   */
  position(elapsed: number): { readonly take: number; readonly t: number } {
    const last = Math.max(this.lengths.length - 1, 0);
    if (this.lengths.length === 0 || !(elapsed < this.end)) return { take: last, t: Infinity };
    let start = 0;
    for (let i = 0; i < this.lengths.length; i++) {
      // Past this take's end, the next one's formation stands through the breath.
      if (i === this.lengths.length - 1 || elapsed < start + this.lengths[i]!) return { take: i, t: elapsed - start };
      start += this.lengths[i]! + ReplayClock.breath;
    }
    return { take: last, t: Infinity };
  }
}

// MARK: - Which plays

/** A moment's play: an NBA run is its last basket ("…-run" when that basket also changed the lead). (Replays.play(of:)) */
export const replayPlayOf = (momentID: string): string => (momentID.endsWith("-run") ? momentID.slice(0, -4) : momentID);

/** Whether a run of NBA plays starts at the opening tip (the game's first entry). (Replays.tipOff) */
export function tipOff(first: JSONValue): boolean {
  const clock = num(at(first, "clock", "value"));
  return int(at(first, "period", "number")) === 1 && (clock == null || clock >= 719);
}

/**
 * An archive and the live lane's newest entries as one run in game order:
 * the lane's version of an entry both have (an edit), and what only the
 * lane has after it. (Replays.merged; pure; tested)
 */
export function merged(archive: readonly JSONValue[], lane: readonly JSONValue[]): JSONValue[] {
  if (lane.length === 0) return [...archive];
  const fresh = new Map<string, JSONValue>();
  for (const item of lane) {
    const id = str(at(item, "id"));
    // The newer of two with one ID.
    if (id != null) fresh.set(id, item);
  }
  const seen = new Set<string>();
  const out = archive.map((item) => {
    const id = str(at(item, "id"));
    if (id == null) return item;
    seen.add(id);
    return fresh.get(id) ?? item;
  });
  for (const item of lane) {
    const id = str(at(item, "id"));
    if (id != null && !seen.has(id)) out.push(item);
  }
  return out;
}

/**
 * The sports with an isometric view: their lists keep a place for the play
 * glyph from the start (PageReplays.init). The NBA's, not the WNBA's.
 */
export function replaysSupported(event: ScoreEvent | null | undefined): boolean {
  const ref = event?.ref;
  if (ref?.kind !== "espn") return false;
  if (ref.sport === "baseball" || ref.sport === "football" || ref.sport === "soccer") return true;
  return ref.sport === "basketball" && ref.path === "basketball/nba";
}

// MARK: - Who's who

/** Who's who and how they're dressed, for a replay on this page (ReplayContext). */
export interface ReplayContext {
  readonly eventID: string;
  readonly top: Competitor | null;
  readonly bottom: Competitor | null;
  readonly topIsHome: boolean;
  readonly people: Readonly<Record<string, TheaterPerson>>;
  readonly fielders: BaseballFielders | null;
  /** Soccer: each side's roster as ESPN sent it (the well reads them as lineups). */
  readonly rosters: Readonly<Partial<Record<Side, JSONValue>>>;
  /** Baseball: MLB's numbers by name, for the tags. */
  readonly numbers: Readonly<Record<string, string>>;
  /** The page's palette: the end zones and the paint wear it. */
  readonly palette: TeamPalette;
  /** The game's colors, decided once (`GameContext.colors`): what each side wears, as on the live theater. */
  readonly kits?: MatchColors | null;
}

/** Short names ("PHI"), and the teams' full names ("Philadelphia Eagles"). */
export function replayCodes(context: ReplayContext): { readonly top: string; readonly bottom: string } {
  return { top: context.top?.abbreviation ?? "", bottom: context.bottom?.abbreviation ?? "" };
}

export function replayTeams(context: ReplayContext): { readonly top: string; readonly bottom: string } {
  const codes = replayCodes(context);
  return { top: context.top?.name || codes.top, bottom: context.bottom?.name || codes.bottom };
}

/**
 * What each side wears, as the live theaters dress them (ReplayContext.kits):
 * the page's colors, decided once; else the game's, from its teams and kits
 * (MatchColors(top:bottom:topIsHome:)).
 */
export function replayKits(context: ReplayContext): MatchColors {
  if (context.kits) return context.kits;
  const { top, bottom } = context;
  return matchColors(
    { color: top?.color ?? null, alternate: top?.alternateColor ?? null },
    { color: bottom?.color ?? null, alternate: bottom?.alternateColor ?? null },
    { topKit: top?.kit ?? null, bottomKit: bottom?.kit ?? null, home: context.topIsHome ? "top" : "bottom" },
  );
}
