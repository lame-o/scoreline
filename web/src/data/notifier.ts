/**
 * What an alert for a followed team says (Notifier.swift, the pure part):
 * the title is the score line ("Arsenal 2–1 Chelsea"); the body says what
 * happened: "Started", "Goal · 23rd minute", "Chiefs scored · 3:10 left in
 * the 2nd", "Full time". Each game has one alert that replaces itself
 * (`tag`), so a match never stacks a pile of them.
 *
 * The web side (state/notifications.ts) compares each poll with the last
 * for games involving a followed team and posts what this returns.
 */
import { clockText } from "./clock";
import { scoreLine, spokenEventStatus } from "./format";
import { competitorKey, competitors, eventSport, type ScoreEvent } from "./models";
import { scorers } from "./scoreboard";

/** The status as a screen reader says it, with a live clock read at `now` (Swift `Event.spokenStatus`). */
function spoken(event: ScoreEvent, now: number): string {
  const clock = event.state === "live" && event.clock ? clockText(event.clock, now) : null;
  return spokenEventStatus(event, now, clock);
}

/**
 * What an alert says under the score line, or null when the change isn't
 * news: a start, a final (one without scores is a postponement, not a
 * result), or a live score change. A correction (a goal taken back) or two
 * polls' worth at once says "Score updated".
 */
export function notificationBody(before: ScoreEvent, after: ScoreEvent, now: number): string | null {
  const scored = competitors(after).every((c) => c.score != null);
  if (before.state === "scheduled" && after.state === "live") return "Started";
  if ((before.state === "live" || before.state === "scheduled") && after.state === "final" && scored) return spoken(after, now);
  if (before.state === "live" && after.state === "live") {
    const was = competitors(before).map((c) => c.score);
    const is = competitors(after).map((c) => c.score);
    if (was.length === is.length && was.every((s, i) => s === is[i])) return null;
    const status = spoken(after, now);
    const rose = scorers(before, after);
    const team = rose.size === 1 ? competitors(after).find((c) => rose.has(competitorKey(c))) : undefined;
    if (!team) return `Score updated · ${status}`;
    return eventSport(after) === "soccer" ? `Goal · ${status}` : `${team.name} scored · ${status}`;
  }
  return null;
}

export interface Alert {
  /** The game: each alert replaces the game's last one. */
  readonly tag: string;
  readonly title: string;
  readonly body: string;
}

/** The alert for a change, or null (Notifier.notifyChanges). */
export function alertFor(before: ScoreEvent, after: ScoreEvent, now: number): Alert | null {
  const body = notificationBody(before, after, now);
  return body ? { tag: after.id, title: scoreLine(after, false), body } : null;
}

/**
 * The alerts one poll brings: games involving a followed team that changed
 * since the last poll. A game seen for the first time says nothing (nothing
 * is news on the first load).
 */
export function pollAlerts(
  previous: ReadonlyMap<string, ScoreEvent>,
  next: readonly ScoreEvent[],
  involvesFollowed: (e: ScoreEvent) => boolean,
  now: number,
): Alert[] {
  const alerts: Alert[] = [];
  for (const event of next) {
    const before = previous.get(event.id);
    if (!before || before === event || !involvesFollowed(event)) continue;
    const alert = alertFor(before, event, now);
    if (alert) alerts.push(alert);
  }
  return alerts;
}
