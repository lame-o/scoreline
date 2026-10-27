/**
 * Calendar days with no time zone attached (ScheduleModels.swift `DayKey`):
 * the day a game or competition is listed on. Climbing uses venue-local
 * dates as published; never convert them.
 */

export interface DayKey {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** "2026-10-25", or the date part of "2026-10-25T07:00Z". */
export function dayKeyFromISO(iso: string | null | undefined): DayKey | null {
  if (!iso || iso.length < 10) return null;
  const parts = iso.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
  return { year: parts[0]!, month: parts[1]!, day: parts[2]! };
}

/** The viewer's day at `ms`. */
export function dayKeyOf(ms: number): DayKey {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Local midnight at the start of the day. */
export function startOfDay(key: DayKey): number {
  return new Date(key.year, key.month - 1, key.day).getTime();
}

export function compareDays(a: DayKey, b: DayKey): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/** Noon, so no zone can move the day when it's formatted. */
function displayDate(key: DayKey): Date {
  return new Date(key.year, key.month - 1, key.day, 12);
}

const shortFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const mediumFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

/** "Oct 25" */
export function shortDayLabel(key: DayKey): string {
  return shortFormat.format(displayDate(key));
}

/** "Sun, Oct 25" */
export function mediumDayLabel(key: DayKey): string {
  return mediumFormat.format(displayDate(key));
}

/** "Apr 9–11", "Apr 30–May 2", "Dec 30–Jan 3, 2028" (across years). */
export function dayRangeLabel(a: DayKey, b: DayKey): string {
  if (compareDays(a, b) === 0) return shortDayLabel(a);
  if (a.year === b.year && a.month === b.month) return `${shortDayLabel(a)}–${b.day}`;
  if (a.year === b.year) return `${shortDayLabel(a)}–${shortDayLabel(b)}`;
  return `${shortDayLabel(a)}–${shortDayLabel(b)}, ${b.year}`;
}
