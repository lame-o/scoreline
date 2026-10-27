/**
 * Live state for schedule rows (ScheduleRow.event(for:store:)): games around
 * today take the scores list's copy (same IDs), so a game in progress ticks
 * and scores here too. A game the board already calls final can't change:
 * reading the scoreboard for it would tie the row to every poll.
 */
import { useCallback, useMemo } from "react";
import { compareDays, daysBetween, dayKeyOf } from "../../data/days";
import type { ScoreEvent } from "../../data/models";
import { itemEvent, type ScheduleItem } from "../../data/schedule";
import { useSplit } from "../../app/layout";
import { useScoreboard } from "../../state/scores";

/** Each item's own event, made once per item object. */
const own = new WeakMap<ScheduleItem, ScoreEvent>();

export function baseEvent(item: ScheduleItem): ScoreEvent {
  let e = own.get(item);
  if (!e) {
    e = itemEvent(item);
    own.set(item, e);
  }
  return e;
}

/** `eventFor(item)`: the item as the scores list sees it now, or its own event. */
export function useLiveEvents(): { eventFor: (item: ScheduleItem) => ScoreEvent; isLive: (item: ScheduleItem) => boolean; version: unknown } {
  const split = useSplit();
  // Beside the sidebar, its scores poll; on a phone this page reads (and polls) them itself.
  const scores = useScoreboard({ poll: !split });
  const lookup = scores.event;
  const today = dayKeyOf(Date.now());
  const eventFor = useCallback(
    (item: ScheduleItem): ScoreEvent => {
      const base = baseEvent(item);
      if (item.status === "final" || Math.abs(daysBetween(today, item.day)) > 1) return base;
      return lookup(item.id) ?? base;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookup, compareDays(today, today), today.day],
  );
  const isLive = useCallback((item: ScheduleItem) => eventFor(item).state === "live", [eventFor]);
  return useMemo(() => ({ eventFor, isLive, version: lookup }), [eventFor, isLive, lookup]);
}
