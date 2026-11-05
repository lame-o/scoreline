/**
 * What the timeline plots (MatchTimeline.swift `TimelineMark`,
 * `GameDetail.timelineMarks`, `SoccerClock`), by the same IDs as the rows it
 * links to: the key moments (soccer's goals and cards, the NBA's Key Plays,
 * the scoring plays) and football's turnovers. A period's end is a landmark,
 * not a mark. Times are epoch ms.
 */
import type { DetailMoment } from "../gameDetail";
import { shortened } from "../moments";
import type { OddsPeriod } from "./espn";
import { historyEnd, historyStart, playOf, type MatchHistory } from "./history";

/** A key moment on the timeline, and when it happened: on the wall clock; null when only its match minute is known. */
export interface TimelineMark {
  readonly moment: DetailMoment;
  readonly t: number | null;
}

export const markID = (m: TimelineMark): string => m.moment.id;

/** The marks for a game: its key moments placed on the history's wall clock, and football's turnovers. (pure; tested) */
export function timelineMarks(detail: { readonly moments: readonly DetailMoment[]; readonly history: MatchHistory | null }): TimelineMark[] {
  const plotted = detail.moments.filter((m) => m.kind !== "other");
  const history = detail.history;
  if (!history || history.events.length === 0) return plotted.filter((m) => m.minute != null).map((moment) => ({ moment, t: null }));
  const times = new Map<string, number>();
  for (const e of history.events) if (!times.has(e.id)) times.set(e.id, e.t);
  const start = historyStart(history);
  const clock = start != null ? new SoccerClock(start, history.periods, historyEnd(history)) : null;
  const marks: TimelineMark[] = [];
  for (const moment of plotted) {
    const byMinute = history.sport === "soccer" && moment.minute != null && clock ? clock.wall(moment.minute) : null;
    const t = times.get(playOf(moment.id)) ?? byMinute;
    if (t != null) marks.push({ moment, t });
  }
  const scoring = new Set(plotted.map((m) => playOf(m.id)));
  for (const event of history.events) {
    if (!event.turnover || scoring.has(event.id)) continue;
    marks.push({ moment: { id: event.id, kind: "turnover", clock: event.clock, text: event.text, side: event.side, minute: null, score: null, period: event.period }, t: event.t });
  }
  // A stable sort by time: what ⌥←/→ walks.
  return marks.map((m, k) => ({ m, k })).sort((a, b) => (a.m.t ?? -Infinity) - (b.m.t ?? -Infinity) || a.k - b.k).map((x) => x.m);
}

/**
 * Soccer's match clock against the wall. It never stops, so inside a half a
 * minute is a minute: each half's marks are honest measured from its own
 * kickoff, and the breaks keep their real width between them. A half that
 * hasn't started yet is projected, a usual first half and break on. (pure; tested)
 */
export class SoccerClock {
  /** A first half with its stoppage, and with its break too (ms). */
  static readonly firstHalf = 48 * 60_000;
  static readonly firstHalfAndBreak = 63 * 60_000;

  constructor(
    readonly start: number,
    readonly periods: readonly OddsPeriod[],
    /** How far the game has got: a long break pushes the projected kickoff along. */
    readonly now: number | null,
  ) {}

  /** When the first half's break began: its last play, once it's over. */
  get breakStart(): number {
    const first = this.periods[0];
    if (!first || !(this.periods.length > 1 || (this.now ?? this.start) > this.start + SoccerClock.firstHalf)) return this.start + SoccerClock.firstHalf;
    return first.end;
  }

  /** The second half's kickoff, played or projected. */
  get secondHalf(): number {
    return this.periods.length > 1 ? this.periods[1]!.start : Math.max(this.start + SoccerClock.firstHalfAndBreak, this.now ?? this.start);
  }

  wall(minute: number): number {
    if (minute <= 45) return this.start + minute * 60_000;
    if (minute > 105 && this.periods.length > 3) return this.periods[3]!.start + (minute - 105) * 60_000;
    if (minute > 90 && this.periods.length > 2) return this.periods[2]!.start + (minute - 90) * 60_000;
    return this.secondHalf + (minute - 45) * 60_000;
  }

  minute(t: number): number {
    const bases = [0, 45, 90, 105];
    let index = -1;
    this.periods.slice(0, bases.length).forEach((p, k) => {
      if (p.start <= t) index = k;
    });
    if (index < 0) return (t - this.start) / 60_000;
    return bases[index]! + (t - this.periods[index]!.start) / 60_000;
  }
}

/**
 * Soccer: the icon already says goal or card, so the row is the player
 * ("Fer Niño Penalty - Scored" → "Fer Niño (pen)"). Other text passes
 * through (MomentList.headline).
 */
export function momentHeadline(m: Pick<DetailMoment, "kind" | "text">): string {
  return m.kind === "goal" || m.kind === "ownGoal" || m.kind === "yellow" || m.kind === "red" ? shortened(m.text) : m.text;
}

/** "Top 7th Inning" → "Top 7th" (MomentList.shortClock). */
export const shortClock = (clock: string): string => clock.replaceAll(" Inning", "");
