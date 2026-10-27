/**
 * The tab's live score, the web's menu bar item (MenuBarLabel.swift,
 * ScoreStore.menuBarEvent): the title and favicon show the pinned game, or
 * else a followed team's live game (or one that just finished), so the score
 * reads from the tab strip while you're in another tab.
 *
 * Pure: state/tabScore.ts feeds it the scoreboard, the pin and the clock.
 */
import { competitors, type ScoreEvent } from "./models";
import { scoreLine } from "./format";

/** How long a followed game's final lingers in the tab (ScoreStore.recentFinals). */
export const RECENT_FINAL_MS = 10 * 60_000;
/** A pinned game lets go this long after its start once it's over (ScoreStore.refresh). */
export const PIN_LAPSE_MS = 4 * 3_600_000;

export interface TabContext {
  readonly pinnedID: string | null;
  readonly isFollowed: (e: ScoreEvent) => boolean;
  /** Followed games that just ended: event ID → when (epoch ms). */
  readonly recentFinals: ReadonlyMap<string, number>;
  /** Settings → Tab → Live score (the Mac's `scoreInMenuBar`). The pin shows regardless. */
  readonly scoreInTitle: boolean;
  readonly now: number;
}

/**
 * The game the tab shows: the pinned one, otherwise (when the setting is on)
 * the first followed game that's live, in the user's league order, or one
 * that finished in the last ten minutes. Null: the tab is just "Scoreline".
 */
export function tabEvent(events: readonly ScoreEvent[], context: TabContext): ScoreEvent | null {
  if (context.pinnedID) {
    const pinned = events.find((e) => e.id === context.pinnedID);
    if (pinned) return pinned;
  }
  if (!context.scoreInTitle) return null;
  const mine = events.filter(context.isFollowed);
  return (
    mine.find((e) => e.state === "live") ??
    mine.find((e) => {
      const at = context.recentFinals.get(e.id);
      return e.state === "final" && at != null && context.now - at < RECENT_FINAL_MS;
    }) ??
    null
  );
}

/**
 * "ARS 2–1 CHE · 67'": the score line, abbreviated, then the status; ESPN's
 * "3:10 - 2nd" reads "3:10 2nd" (MenuBarLabel.text). A scheduled game shows
 * its time. No width budget: a tab has no notch.
 */
export function tabTitle(event: ScoreEvent): string {
  const line = scoreLine(event, true);
  let status: string;
  switch (event.state) {
    case "live":
      status = event.detail ?? "";
      break;
    case "final":
      status = event.detail ?? "Final";
      break;
    case "scheduled":
      status = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(event.start);
      break;
  }
  const tidy = status.replaceAll(" - ", " ").trim();
  return tidy ? `${line} · ${tidy}` : line;
}

export interface FaviconScore {
  /** One line ("2–1"), or the two scores stacked ("148" over "150") when one line can't stay legible at 16px. */
  readonly lines: readonly string[];
  readonly live: boolean;
}

/** What the favicon draws for a game: its score, or null (no score yet, or a climbing round). */
export function faviconScore(event: ScoreEvent): FaviconScore | null {
  if (event.content.kind !== "match" || event.state === "scheduled") return null;
  const [top, bottom] = competitors(event);
  const a = top?.score;
  const b = bottom?.score;
  if (a == null || b == null) return null;
  const lines = a.length + b.length <= 3 ? [`${a}–${b}`] : [a, b];
  return { lines, live: event.state === "live" };
}

/** Whether a pin has lapsed: the game is over and started more than four hours ago. */
export function pinExpired(event: ScoreEvent, now: number): boolean {
  return event.state === "final" && event.start < now - PIN_LAPSE_MS;
}
