/**
 * The game page's sections against its header (web; the live check, Game 4
 * and an NBA game on Oct 27): the summary-driven sections trail the header
 * by a minute or two, since the header reads the sport's fast lane every few
 * seconds and the summary is ESPN's slower copy. On the NBA page Q1's cell
 * went back to 12–9 while the total said 12–12, and the scores list beside
 * the page still had the old score. A section never shows older data than
 * the header:
 *
 * - `HeaderLedger` keeps what the header said in each period (its last
 *   reading there), and `reconcileLinescore` brings a line score that trails
 *   it up to date: each period's cell is at least what the header's readings
 *   put in it, the period under way takes the rest when the line has its
 *   column, and the total is the header's. A line that has caught up (or is
 *   ahead: a correction) is shown as ESPN has it.
 * - `withLaneScore` gives the scores list a game's newer score from its page's
 *   lane until the scoreboard catches up (state/laneScores.ts).
 *
 * The Mac reads the same feeds the same way, so it can show the same lag.
 */
import type { Linescore } from "./gameDetail";
import type { ScoreEvent } from "./models";

/** The header's score, top first, and the period it was read in (null: none known). */
export interface HeaderReading {
  readonly period: number | null;
  readonly top: number;
  readonly bottom: number;
}

/** The period in a sport's live text: an inning ("Top 7th", "Mid 7th", "End 7th"), a quarter ("3rd"). */
export function periodIn(text: string | null | undefined): number | null {
  const m = text != null ? /(\d+)/.exec(text) : null;
  return m?.[1] != null ? Number(m[1]) : null;
}

/** The header's score as numbers, when both are. */
export function headerReading(top: string | null | undefined, bottom: string | null | undefined, period: number | null): HeaderReading | null {
  const t = top != null && top.trim() !== "" ? Number(top) : Number.NaN;
  const b = bottom != null && bottom.trim() !== "" ? Number(bottom) : Number.NaN;
  return Number.isFinite(t) && Number.isFinite(b) ? { period, top: t, bottom: b } : null;
}

/**
 * What the header has said in each period of the game, read by read: the
 * last reading in a period is the score at its end (or now, for the one
 * under way). A store, so a section can follow it without its page
 * rendering again.
 */
export class HeaderLedger {
  private readonly ends = new Map<number, HeaderReading>();
  private latest: HeaderReading | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();

  /** A reading of the header; said to followers only when it's new. */
  observe(reading: HeaderReading | null): void {
    if (!reading) return;
    const was = this.latest;
    if (was && was.period === reading.period && was.top === reading.top && was.bottom === reading.bottom) return;
    this.latest = reading;
    if (reading.period != null) this.ends.set(reading.period, reading);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** The newest reading. */
  get now(): HeaderReading | null {
    return this.latest;
  }

  /** The header's score at the end of a period (or now, in the period under way), when it was read in it. */
  end(period: number): HeaderReading | null {
    return this.ends.get(period) ?? null;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;
}

const cellValue = (cell: string | undefined): number | null => {
  if (cell == null || !/^\s*\d+\s*$/.test(cell)) return null;
  return Number(cell);
};

/**
 * A line score no older than the header (pure; tested). Its period columns
 * are the ones before its total ("T", or baseball's "R"); `ledger` is what
 * the header has said in each period. While the cells add up to less than
 * the header's score, each period's cell is brought up to what the header
 * said at its end, the period under way (when the line already has its
 * column) takes what's left, and the total is the header's. Columns the line
 * doesn't have yet aren't made up: they come with the summary.
 */
export function reconcileLinescore<L extends Linescore>(line: L, ledger: Pick<HeaderLedger, "now" | "end">): L {
  const header = ledger.now;
  const total = line.headers.findIndex((h) => h === "T" || h === "R");
  if (!header || total < 1 || line.top.length !== line.headers.length || line.bottom.length !== line.headers.length) return line;
  const cells = (row: readonly string[]) => row.slice(0, total).map(cellValue);
  const top = cells(line.top);
  const bottom = cells(line.bottom);
  const sum = (values: readonly (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);
  const lineTop = cellValue(line.top[total]);
  const lineBottom = cellValue(line.bottom[total]);
  const behind = header.top > sum(top) || header.bottom > sum(bottom);
  const totalBehind = (lineTop != null && header.top > lineTop) || (lineBottom != null && header.bottom > lineBottom);
  // Caught up, or ahead of the header (a correction the header hasn't read yet): ESPN's.
  if (!behind && !totalBehind) return line;
  if (header.top < (lineTop ?? 0) || header.bottom < (lineBottom ?? 0)) return line;
  const nextTop = [...line.top];
  const nextBottom = [...line.bottom];
  if (behind) {
    let runningTop = 0;
    let runningBottom = 0;
    for (let i = 0; i < total; i++) {
      const period = i + 1;
      const end = period === header.period ? header : ledger.end(period);
      let cellTop = top[i] ?? null;
      let cellBottom = bottom[i] ?? null;
      if (end) {
        // At least what the header said by the end of it (the period under way: all that's left).
        if (end.top - runningTop > (cellTop ?? 0)) cellTop = end.top - runningTop;
        if (end.bottom - runningBottom > (cellBottom ?? 0)) cellBottom = end.bottom - runningBottom;
      }
      if (cellTop !== (top[i] ?? null) && cellTop != null) nextTop[i] = String(cellTop);
      if (cellBottom !== (bottom[i] ?? null) && cellBottom != null) nextBottom[i] = String(cellBottom);
      runningTop += cellTop ?? 0;
      runningBottom += cellBottom ?? 0;
    }
  }
  nextTop[total] = String(header.top);
  nextBottom[total] = String(header.bottom);
  return { ...line, top: nextTop, bottom: nextBottom };
}

/** A lane's score for an event, top first, and when it was read (epoch ms). */
export interface LaneScore {
  readonly top: string;
  readonly bottom: string;
  readonly at: number;
}

/** How long a lane's score stands in for the scoreboard's before the scoreboard is trusted again. */
export const LANE_SCORE_MS = 3 * 60_000;

/**
 * The event with its page's lane score while that's ahead of the
 * scoreboard's (both sides at least as high, one higher), for a live game,
 * within `LANE_SCORE_MS`; the event itself otherwise. (pure; tested)
 */
export function withLaneScore(event: ScoreEvent, lane: LaneScore | undefined, now: number): ScoreEvent {
  if (!lane || event.state !== "live" || event.content.kind !== "match" || now - lane.at > LANE_SCORE_MS) return event;
  const { top, bottom } = event.content;
  const was = headerReading(top.score, bottom.score, null);
  const is = headerReading(lane.top, lane.bottom, null);
  if (!is || (was && (is.top < was.top || is.bottom < was.bottom || (is.top === was.top && is.bottom === was.bottom)))) return event;
  return { ...event, content: { ...event.content, top: { ...top, score: lane.top }, bottom: { ...bottom, score: lane.bottom } } };
}
