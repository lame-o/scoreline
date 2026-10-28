/**
 * The game pages' lane scores, for the scores list beside them (web; the
 * live check: the sidebar trailed the game's header by a minute or two). A
 * game page whose fast lane reads a score ahead of the scoreboard's publishes
 * it here; the scores list shows it on that game's row and tile until the
 * scoreboard catches up (data/headerSync.ts `withLaneScore`). Only what's
 * shown: alerts and the tab's title keep to the scoreboard's own polls.
 *
 *     publishLaneScore("espn-401908045", { top: "3", bottom: "2" });
 */
import type { ScoreEvent } from "../data/models";
import { withLaneScore, type LaneScore } from "../data/headerSync";

const scores = new Map<string, LaneScore>();
const listeners = new Set<() => void>();
let version = 0;

/** A page's lane score for its event (null: none ahead of the scoreboard). */
export function publishLaneScore(eventID: string, score: { readonly top: string; readonly bottom: string } | null, now = Date.now()): void {
  const was = scores.get(eventID);
  if (score == null) {
    // A page closing leaves its last reading to stand until the scoreboard catches up (or it lapses).
    return;
  }
  if (was && was.top === score.top && was.bottom === score.bottom) return;
  scores.set(eventID, { top: score.top, bottom: score.bottom, at: now });
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeLaneScores(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const laneScoresVersion = (): number => version;

/** One copy per event object and reading, so rows memoized on their event don't render for nothing. */
const shown = new WeakMap<ScoreEvent, { lane: LaneScore; event: ScoreEvent }>();

/** The events as the list shows them: each with its page's newer lane score, while the scoreboard trails it. */
export function withLaneScores(events: readonly ScoreEvent[], now = Date.now()): readonly ScoreEvent[] {
  if (scores.size === 0) return events;
  let changed = false;
  const out = events.map((e) => {
    const lane = scores.get(e.id);
    if (!lane) return e;
    const kept = shown.get(e);
    if (kept && kept.lane === lane) return kept.event;
    const next = withLaneScore(e, lane, now);
    if (next !== e) {
      shown.set(e, { lane, event: next });
      changed = true;
    }
    return next;
  });
  return changed || out.some((e, i) => e !== events[i]) ? out : events;
}

/** Tests: forget every lane score. */
export function resetLaneScores(): void {
  scores.clear();
  version += 1;
}
