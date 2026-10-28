/**
 * The game page's sections kept no older than its header (data/headerSync.ts;
 * the live check): `useHeaderSync` records what the header says, period by
 * period, and gives the scores list the page's lane score while it's ahead
 * of the scoreboard's; `SyncedLinescore` is the line score brought up to the
 * header's readings, following them without its page rendering again.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { headerReading, HeaderLedger, periodIn, reconcileLinescore } from "../../../data/headerSync";
import type { Linescore } from "../../../data/gameDetail";
import type { ScoreEvent } from "../../../data/models";
import { publishLaneScore } from "../../../state/laneScores";
import { LinescoreGrid } from "./CommonSections";
import type { SportPage } from "./sport";

/** One ledger per page. */
export function useHeaderLedger(): HeaderLedger {
  const ledger = useRef<HeaderLedger | null>(null);
  if (!ledger.current) ledger.current = new HeaderLedger();
  return ledger.current;
}

/**
 * Records the header's reading while the game is live (its score, top
 * first, and the period: the lane's clock, the scoreboard's, else the
 * inning in its text), and publishes the lane's score for the scores list.
 */
export function useHeaderSync(ledger: HeaderLedger, event: ScoreEvent, scores: { top: string | null; bottom: string | null }, sport: SportPage): void {
  const live = event.state === "live";
  const period = sport.clock?.period ?? event.clock?.period ?? periodIn(sport.clockFallback ?? event.detail);
  useEffect(() => {
    if (live) ledger.observe(headerReading(scores.top, scores.bottom, period));
  }, [ledger, live, scores.top, scores.bottom, period]);
  const laneTop = sport.laneScores?.top ?? null;
  const laneBottom = sport.laneScores?.bottom ?? null;
  useEffect(() => {
    if (live && laneTop != null && laneBottom != null) publishLaneScore(event.id, { top: laneTop, bottom: laneBottom });
  }, [live, event.id, laneTop, laneBottom]);
}

const never = () => () => {};
const zero = () => 0;

/** The line score as the header has it now (the grid's own props otherwise). */
export function SyncedLinescore({ ledger, linescore, ...grid }: { ledger: HeaderLedger | undefined; linescore: Linescore } & Omit<Parameters<typeof LinescoreGrid>[0], "linescore">) {
  useSyncExternalStore(ledger?.subscribe ?? never, ledger?.snapshot ?? zero, zero);
  return <LinescoreGrid linescore={ledger ? reconcileLinescore(linescore, ledger) : linescore} {...grid} />;
}
