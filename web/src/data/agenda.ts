/**
 * The agenda: a schedule's items as day sections, and the rules every
 * schedule page applies (ScheduleModels.swift `Agenda`, ScheduleStore.swift
 * `filter`, `collapseTournamentDays`, `climbingItems`, `ttl`, SchedulePage
 * `cap`, `dots`). Pure, so it's tested without a DOM.
 */
import { addingDays, compareDays, dayID, daysBetween, dayKeyIn, dayKeyOf, type DayKey } from "./days";
import { plural } from "./format";
import { leagueWithID } from "./leagues";
import type { League } from "./models";
import { groupLeague } from "./providers/schedule";
import { sortItems } from "./results";
import { dayCount, isField, itemTeams, scheduleItem, startDate, type ScheduleItem, type SeasonEvent } from "./schedule";
import type { ListPreferences } from "./scoreboard";
import { flagFromISO } from "./teams";

export interface AgendaGroup {
  /** League ID (or "all" for an ungrouped day). */
  readonly league: string;
  readonly title: string;
  /** Timed items by start, then those without a time. */
  readonly items: readonly ScheduleItem[];
}

export interface AgendaDay {
  readonly day: DayKey;
  readonly groups: readonly AgendaGroup[];
  /** NFL/college: teams without a game this week, on the week's last day. */
  readonly byes: readonly string[];
}

export const dayItems = (day: AgendaDay): ScheduleItem[] => day.groups.flatMap((g) => g.items);

/**
 * Day sections. With `grouped`, each day is split into leagues in
 * `leagueOrder` (the user's order; unknown leagues last); otherwise one group.
 */
export function buildAgenda(items: readonly ScheduleItem[], leagueOrder: readonly string[], grouped: boolean): AgendaDay[] {
  const seen = new Set<string>();
  const unique = items.filter((i) => !seen.has(i.id) && seen.add(i.id));
  const byDay = new Map<string, { day: DayKey; items: ScheduleItem[] }>();
  for (const item of unique) {
    const key = dayID(item.day);
    const entry = byDay.get(key) ?? { day: item.day, items: [] };
    entry.items.push(item);
    byDay.set(key, entry);
  }
  const rank = new Map<string, number>();
  leagueOrder.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  return [...byDay.values()]
    .sort((a, b) => compareDays(a.day, b.day))
    .map(({ day, items: dayList }): AgendaDay => {
      if (!grouped) return { day, groups: [{ league: "all", title: "", items: sortItems(dayList) }], byes: [] };
      const byLeague = new Map<string, ScheduleItem[]>();
      // Cross-competition fixtures (Carabao Cup, a club's cup tie) sit with their sport's league rather than as a group of one.
      for (const item of dayList) {
        const key = groupLeague(item);
        byLeague.set(key, [...(byLeague.get(key) ?? []), item]);
      }
      const keys = [...byLeague.keys()].sort((a, b) => {
        const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
        return ra !== rb ? ra - rb : a < b ? -1 : a > b ? 1 : 0;
      });
      return { day, groups: keys.map((key) => ({ league: key, title: leagueWithID(key)?.name ?? key, items: sortItems(byLeague.get(key) ?? []) })), byes: [] };
    });
}

/**
 * The days a page opens unfolded: today and the next game day, and one more
 * when those two hold fewer than `minimum` games (a Thursday night game
 * shouldn't leave Sunday folded). Everything after starts folded.
 */
export function defaultOpen(upcoming: readonly AgendaDay[], today: DayKey, minimum = 6): Set<string> {
  const open = new Set<string>();
  let games = 0;
  for (const day of upcoming) {
    if (compareDays(day.day, today) < 0) continue;
    if ((open.size >= 2 && games >= minimum) || open.size >= 3) break;
    open.add(dayID(day.day));
    games += dayItems(day).length;
  }
  return open;
}

/** "14 games", "3 games · 1 event" (climbing rounds and the like are events). */
export function dayCountLabel(day: AgendaDay): string {
  const items = dayItems(day);
  const matches = items.filter((i) => !isField(i)).length;
  const events = items.length - matches;
  const parts: string[] = [];
  if (matches > 0) parts.push(plural(matches, "game"));
  if (events > 0) parts.push(plural(events, "event"));
  return parts.join(" · ");
}

/** "EPL, NBA, Climbing": the day's leagues, short names, in the page's order. */
export function dayLeagues(day: AgendaDay): string {
  return day.groups.map((g) => leagueWithID(g.league)?.shortName ?? g.title).join(", ");
}

/** A folded day in one line: "14 games · NFL, NBA, EPL" (a league page names no league). */
export function daySummary(day: AgendaDay, namesLeagues: boolean): string {
  return [dayCountLabel(day), namesLeagues ? dayLeagues(day) : ""].filter(Boolean).join(" · ");
}

/** Days before `today` (results) and from `today` on. */
export function splitDays(days: readonly AgendaDay[], today: DayKey): { earlier: AgendaDay[]; upcoming: AgendaDay[] } {
  return { earlier: days.filter((d) => compareDays(d.day, today) < 0), upcoming: days.filter((d) => compareDays(d.day, today) >= 0) };
}

/** Form over the last results of `teamID`, oldest first: "W", "D", "L". */
export function form(items: readonly ScheduleItem[], teamID: string, last = 5): string[] {
  const played = items
    .filter((i) => i.status === "final" && itemTeams(i).some((t) => t.id === teamID))
    .sort((a, b) => (startDate(a.start) ?? 0) - (startDate(b.start) ?? 0))
    .slice(-last);
  return played.map((item) => {
    const mine = itemTeams(item).find((t) => t.id === teamID);
    const other = itemTeams(item).find((t) => t.id !== teamID);
    if (!mine || !other) return "–";
    if (mine.winner) return "W";
    if (other.winner) return "L";
    return "D";
  });
}

/** Rows per page of a long season. */
export const AGENDA_PAGE = 40;

/** The first (or last) `items` rows of the days, and how many more there are. */
export function capDays(days: readonly AgendaDay[], items: number, fromEnd: boolean): { days: AgendaDay[]; hidden: number } {
  const total = days.reduce((n, d) => n + dayItems(d).length, 0);
  if (total <= items) return { days: [...days], hidden: 0 };
  const kept: AgendaDay[] = [];
  let count = 0;
  for (const day of fromEnd ? [...days].reverse() : days) {
    if (count >= items) break;
    kept.push(day);
    count += dayItems(day).length;
  }
  return { days: fromEnd ? kept.reverse() : kept, hidden: Math.max(total - count, 0) };
}

// MARK: - Filters (the scores list's, so the two agree)

/** Team picks and the college Top 25 filter, unless `showAll` lifts them for this page. */
export function filterItems(items: readonly ScheduleItem[], league: League, prefs: ListPreferences, showAll: boolean): ScheduleItem[] {
  if (league.source.kind === "ifsc") return [...items];
  if (!showAll && prefs.filteredLeagues.includes(league.id)) {
    const picks = new Set(prefs.teamFilters[league.id] ?? []);
    if (picks.size > 0) return items.filter((item) => isField(item) || itemTeams(item).some((t) => t.id != null && picks.has(t.id)));
  }
  if (!showAll && league.id === "college-football" && prefs.collegeTop25Only) {
    const followed = new Set(prefs.followed.map((t) => t.id));
    return items.filter((item) => itemTeams(item).some((t) => t.rank != null || (t.id != null && followed.has(t.id))));
  }
  return [...items];
}

/** Whether a league page can lift its filter (Show All Games). */
export function filterable(league: League, prefs: ListPreferences): boolean {
  return (prefs.filteredLeagues.includes(league.id) && (prefs.teamFilters[league.id] ?? []).length > 0) || league.id === "college-football";
}

// MARK: - CS2 and climbing in a day agenda

/** CS2 in the All scope: followed teams' matches stay rows; every other match folds into one row per tournament day. */
export function collapseTournamentDays(matches: readonly ScheduleItem[], followed: ReadonlySet<string>): ScheduleItem[] {
  const rows: ScheduleItem[] = [];
  const groups = new Map<string, ScheduleItem[]>();
  for (const match of matches) {
    if (itemTeams(match).some((t) => t.id != null && followed.has(t.id))) rows.push(match);
    else {
      const key = `${match.competition ?? ""}|${dayID(match.day)}`;
      groups.set(key, [...(groups.get(key) ?? []), match]);
    }
  }
  for (const [key, group] of groups) {
    const sorted = sortItems(group);
    const first = sorted[0];
    if (!first) continue;
    const live = sorted.some((m) => m.status === "live");
    const allFinal = sorted.every((m) => m.status === "final" || m.status === "canceled");
    const count = sorted.length;
    const names = sorted.slice(0, 2).map((m) => itemTeams(m).map((t) => t.abbreviation).join(" v "));
    const subtitle = [`${count} match${count === 1 ? "" : "es"}`, names.join(", ") + (count > 2 ? " …" : "")].filter(Boolean).join(" · ");
    rows.push(
      scheduleItem({
        id: `cs-day-${key}`,
        sport: "esports",
        league: "cs2",
        day: first.day,
        start: first.start,
        status: live ? "live" : allFinal ? "final" : "scheduled",
        title: first.competition ?? "Tournament",
        subtitle,
        ref: first.ref,
        children: sorted,
      }),
    );
  }
  return rows;
}

const capitalize = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);

/** A climbing competition in a day agenda: its rounds with known days, otherwise one line per competition day. */
export function climbingItems(event: SeasonEvent, from: DayKey, to: DayKey): ScheduleItem[] {
  if (event.kind.kind !== "climbing") return [];
  const eventID = event.kind.id;
  const zone = event.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const flag = flagFromISO(event.countryCode);
  const items: ScheduleItem[] = [];
  const covered = new Set<string>();
  for (const round of event.rounds) {
    const date = startDate(round.start);
    if (date == null) continue;
    const day = dayKeyOf(date);
    if (compareDays(from, day) > 0 || compareDays(day, to) > 0) continue;
    covered.add(dayID(dayKeyIn(date, zone)));
    const label = `${round.discipline} ${round.name.toLowerCase()}`;
    items.push(
      scheduleItem({
        id: `${event.id}-${round.discipline}|${round.name}`,
        sport: "climbing",
        league: "ifsc",
        day,
        start: round.start,
        status: round.status === "finished" ? "final" : round.status === "active" ? "live" : "scheduled",
        title: capitalize(label),
        subtitle: [flag, event.shortName].filter(Boolean).join(" ") + (round.categories.length ? ` · ${round.categories.join(" & ")}` : ""),
        networks: round.stream ? ["YouTube"] : [],
        link: round.stream ?? event.link,
        ref: { kind: "climbing", eventID },
      }),
    );
  }
  const n = dayCount(event);
  for (let offset = 0; offset < n; offset++) {
    const day = addingDays(event.startDay, offset);
    if (compareDays(from, day) > 0 || compareDays(day, to) > 0 || covered.has(dayID(day))) continue;
    items.push(
      scheduleItem({
        id: `${event.id}-day${offset + 1}`,
        sport: "climbing",
        league: "ifsc",
        day,
        start: { kind: "tba" },
        status: event.status === "finished" ? "final" : "scheduled",
        title: `${event.shortName} · Day ${offset + 1} of ${n}`,
        subtitle: [flag, event.lanes.map(capitalize).join(" · ")].filter(Boolean).join(" "),
        link: event.link,
        ref: { kind: "climbing", eventID },
      }),
    );
  }
  return items;
}

// MARK: - Freshness (ScheduleStore.ttl)

/** How long data about `day` stays fresh, in ms: results more than 48 hours old are final (30 days), the coming week changes, the far future rarely. */
export function freshness(day: DayKey, today: DayKey): number {
  const ahead = daysBetween(today, day);
  if (ahead < -2) return 30 * 86_400_000;
  if (ahead <= 7) return 30 * 60_000;
  return 6 * 3_600_000;
}

// MARK: - The week strip's dots

export type StripDot = "games" | "followed" | "live";
const DOT_RANK: Readonly<Record<StripDot, number>> = { games: 0, followed: 1, live: 2 };

/**
 * Dots under the strip: games (from the calendar or the loaded items), a
 * followed team (accent), live now (red). `live(item)` answers from the
 * scoreboard for games around today.
 */
export function stripDots(days: readonly AgendaDay[], followed: ReadonlySet<string>, calendarDays: readonly DayKey[], live: (item: ScheduleItem) => boolean): Map<string, StripDot> {
  const dots = new Map<string, StripDot>();
  for (const d of calendarDays) dots.set(dayID(d), "games");
  for (const day of days) {
    for (const item of dayItems(day)) {
      let dot: StripDot = "games";
      if (itemTeams(item).some((t) => t.id != null && followed.has(t.id))) dot = "followed";
      if (item.status === "live" || live(item)) dot = "live";
      const key = dayID(day.day);
      const current = dots.get(key);
      if (!current || DOT_RANK[dot] > DOT_RANK[current]) dots.set(key, dot);
    }
  }
  return dots;
}
