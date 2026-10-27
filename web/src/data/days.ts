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

// MARK: - Civil arithmetic (ScheduleModels.swift `DayKey`): no zone involved

/** Noon UTC of the civil date: arithmetic that no daylight-saving change can move. */
function civilNoon(key: DayKey): number {
  return Date.UTC(key.year, key.month - 1, key.day, 12);
}

function fromCivil(ms: number): DayKey {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addingDays(key: DayKey, n: number): DayKey {
  return fromCivil(civilNoon(key) + n * 86_400_000);
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((civilNoon(b) - civilNoon(a)) / 86_400_000);
}

/** 1 = Sunday … 7 = Saturday. */
export function weekday(key: DayKey): number {
  return new Date(civilNoon(key)).getUTCDay() + 1;
}

/** The Sunday on or before this day (the strip's weeks run Sunday to Saturday, as Calendar's do). */
export function weekStart(key: DayKey): DayKey {
  return addingDays(key, -(weekday(key) - 1));
}

/** ESPN's `dates=` form: "20261025". */
export function compactDay(key: DayKey): string {
  return `${key.year}${String(key.month).padStart(2, "0")}${String(key.day).padStart(2, "0")}`;
}

/** "2026-10-25": a stable key for maps, sets and URLs. */
export function dayID(key: DayKey): string {
  return `${key.year}-${String(key.month).padStart(2, "0")}-${String(key.day).padStart(2, "0")}`;
}

export function sameDayKey(a: DayKey | null | undefined, b: DayKey | null | undefined): boolean {
  return a != null && b != null && compareDays(a, b) === 0;
}

export function maxDay(a: DayKey, b: DayKey): DayKey {
  return compareDays(a, b) >= 0 ? a : b;
}

export function minDay(a: DayKey, b: DayKey): DayKey {
  return compareDays(a, b) <= 0 ? a : b;
}

/** The day at `ms` in an IANA zone ("America/New_York", "UTC"). */
export function dayKeyIn(ms: number, timeZone: string): DayKey {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** The viewer's offset from a zone at `ms`, in minutes (positive: the viewer is ahead). */
export function offsetFrom(timeZone: string, ms: number): number {
  const there = dayAndMinutes(ms, timeZone);
  const here = new Date(ms);
  const local = Date.UTC(here.getFullYear(), here.getMonth(), here.getDate(), here.getHours(), here.getMinutes());
  return Math.round((local - there) / 60_000);
}

function dayAndMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
}

/** "Today", "Tomorrow", "Yesterday", or null. */
export function relativeDay(key: DayKey, today: DayKey): string | null {
  switch (daysBetween(today, key)) {
    case 0:
      return "Today";
    case 1:
      return "Tomorrow";
    case -1:
      return "Yesterday";
    default:
      return null;
  }
}

const longFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const weekdayNarrow = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
const monthLong = new Intl.DateTimeFormat(undefined, { month: "long" });
const monthShort = new Intl.DateTimeFormat(undefined, { month: "short" });
const monthYear = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/** "Sunday, Oct 25" */
export function longDayLabel(key: DayKey): string {
  return longFormat.format(displayDate(key));
}

/** "Sun" */
export function weekdayLabel(key: DayKey, style: "short" | "narrow" = "short"): string {
  return (style === "short" ? weekdayShort : weekdayNarrow).format(displayDate(key));
}

/** "October" / "Oct" */
export function monthLabel(month: number, style: "long" | "short" = "long", year = 2000): string {
  return (style === "long" ? monthLong : monthShort).format(new Date(year, month - 1, 15, 12));
}

/** "October 2026" */
export function monthYearLabel(year: number, month: number): string {
  return monthYear.format(new Date(year, month - 1, 15, 12));
}
