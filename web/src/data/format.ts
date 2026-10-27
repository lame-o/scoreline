/**
 * How the app says things: ordinals, plurals, times and days, countdowns,
 * and source shorthand turned into words for screen readers. Ported from
 * Models.swift (`Spoken`, `Period`, `plural`), Teams.swift (`Ordinal`),
 * ClimbingBroadcast.swift (`Countdown`, `When`) and ListLayout.swift
 * (`RowText`, `RowStatus`). Pure functions of their inputs and `now`, in the
 * viewer's locale and time zone, as macOS formats them.
 */
import type { ScoreEvent, Sport } from "./models";
import { competitors } from "./models";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// MARK: - Numbers and words

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * "1 game", "3 games", "2 matches": a count and its noun, agreeing. `+s`, or
 * `+es` after s, x, z, ch and sh; pass `pluralForm` for anything irregular.
 */
export function plural(count: number, noun: string, pluralForm?: string): string {
  if (count === 1) return `${count} ${noun}`;
  if (pluralForm) return `${count} ${pluralForm}`;
  const lower = noun.toLowerCase();
  const es = ["s", "x", "z", "ch", "sh"].some((end) => lower.endsWith(end));
  return `${count} ${noun}${es ? "es" : "s"}`;
}

/** One dash style everywhere: "7–1", "5–1–2" (sources send hyphens). */
export function enDash(record: string): string {
  return record.replaceAll("-", "–");
}

// MARK: - Periods (Models.swift `Period`)

/** Regulation periods, after which each one is an overtime: four quarters in football and basketball. */
export function regulationPeriods(sport: Sport): number | null {
  return sport === "football" || sport === "basketball" ? 4 : null;
}

/** "Q3", "OT", "2OT" (short); "3", "OT" (header); "3rd", "2OT" (ordinal); innings are plain numbers. */
export function periodLabel(n: number, sport: Sport, style: "short" | "header" | "ordinal" = "short"): string {
  const regulation = regulationPeriods(sport);
  if (regulation != null) {
    if (n > regulation) return overtime(n - regulation);
    if (style === "short") return `Q${n}`;
    if (style === "header") return `${n}`;
    return ordinal(n);
  }
  return style === "ordinal" ? ordinal(n) : `${n}`;
}

/** The `extra`th overtime: "OT", "2OT", "3OT"… */
export function overtime(extra: number): string {
  return extra <= 1 ? "OT" : `${extra}OT`;
}

// MARK: - Times and days (ClimbingBroadcast.swift `When`, `Countdown`)

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** "7:00 PM" in the viewer's locale. */
export function clockTime(ms: number): string {
  return timeFormat.format(ms);
}

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** "Yesterday", "Tomorrow", "Monday" (within the coming week), "Nov 7"; null for today. */
export function dayName(date: number, now: number): string | null {
  if (sameDay(date, now)) return null;
  if (sameDay(date, addDays(now, 1))) return "Tomorrow";
  if (sameDay(date, addDays(now, -1))) return "Yesterday";
  if (date > now && date - now < 6 * DAY) return weekdayFormat.format(date);
  return monthDayFormat.format(date);
}

/** "Today 7:00 AM", "Tomorrow 7:00 AM", "Monday 7:00 AM", "Nov 7, 7:00 AM". */
export function dayAndTime(date: number, now: number): string {
  const time = clockTime(date);
  const day = dayName(date, now);
  if (day == null) return `Today ${time}`;
  const relative = sameDay(date, addDays(now, -1)) || (date > now && date - now < 6 * DAY);
  return relative ? `${day} ${time}` : `${day}, ${time}`;
}

/** "Starting", "in 25 min", "in 3h 20m" for things starting within a day; null otherwise. */
export function countdown(date: number, now: number): string | null {
  const seconds = (date - now) / 1000;
  if (seconds <= -60) return null;
  if (seconds < 60) return "Starting";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes < 24 * 60) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return null;
}

/** A ticking "2:14:33" / "14:33" inside a day; null otherwise. */
export function countdownClock(date: number, now: number): string | null {
  const seconds = Math.floor((date - now) / 1000);
  if (seconds <= 0 || seconds >= 24 * 3600) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "always", style: "long" });

/** "Updated just now", "Updated 5 minutes ago" (spelled out, never "5 min. ago"). */
export function updatedAgo(date: number, now: number): string {
  const seconds = (now - date) / 1000;
  if (seconds < 60) return "Updated just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Updated ${relativeFormat.format(-minutes, "minute")}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${relativeFormat.format(-hours, "hour")}`;
  return `Updated ${relativeFormat.format(-Math.round(hours / 24), "day")}`;
}

// MARK: - Row text (ListLayout.swift)

/** The line under the teams: live, the situation takes the caption's place. */
export function contextLine(event: ScoreEvent): { text: string; situation: boolean } | null {
  if (event.state === "live" && event.liveLine) return { text: event.liveLine, situation: true };
  return event.caption ? { text: event.caption, situation: false } : null;
}

/**
 * A wide row's detail lane: what's happening or where to watch, over what
 * places the game. Field events (climbing) put their summary first.
 */
export function laneLines(event: ScoreEvent): { primary: string | null; secondary: string | null } {
  const caption = event.caption || null;
  if (event.content.kind === "field") return { primary: event.content.summary || null, secondary: caption };
  const broadcast = event.broadcast || null;
  const venue = event.venue || null;
  switch (event.state) {
    case "live": {
      const situation = event.liveLine || null;
      return { primary: situation ?? broadcast, secondary: caption ?? (situation != null ? broadcast : null) };
    }
    case "scheduled":
      return { primary: broadcast, secondary: caption ?? venue };
    case "final":
      return { primary: null, secondary: caption };
  }
}

/** A final that wasn't played to a result (postponed, canceled, suspended): no score is owed. */
export function unplayed(event: ScoreEvent): boolean {
  const detail = (event.detail ?? "").toLowerCase();
  return ["postpone", "cancel", "suspend", "abandon", "forfeit", "delay"].some((w) => detail.includes(w));
}

/** Past its start and the source says it's delayed: "Delayed" in orange, never "Starting soon" for hours. */
export function isDelayed(event: ScoreEvent, now: number): boolean {
  return event.state === "scheduled" && event.detail === "Delayed" && event.start < now;
}

// MARK: - Spoken (Models.swift `Spoken`)

const FIXED: Readonly<Record<string, string>> = {
  FT: "Full time",
  "FULL TIME": "Full time",
  HT: "Half-time",
  AET: "After extra time",
  "FT-PENS": "After penalties",
  PENS: "After penalties",
  AP: "After penalties",
  FINAL: "Final",
  F: "Final",
  LIVE: "Live",
};

function spokenPeriod(text: string): string {
  const upper = text.toUpperCase();
  if (upper === "OT") return "overtime";
  if (upper.endsWith("OT")) {
    const n = Number(upper.slice(0, -2));
    if (Number.isInteger(n) && n > 0) return `${({ 2: "double", 3: "triple" } as Record<number, string>)[n] ?? ordinal(n)} overtime`;
  }
  return /^\d/.test(text) ? `the ${text}` : text;
}

/**
 * Source shorthand as words a screen reader says naturally: "67'" → "67th
 * minute", "45'+2'" → "45th minute plus 2", "3:10 - 2nd" → "3:10 left in the
 * 2nd", "Top 5th" → "Top of the 5th", "FT" → "Full time", "Final/OT" →
 * "Final, overtime". Anything unrecognized comes back as is (en dashes read "to").
 */
export function spokenStatus(raw: string): string {
  const text = raw.trim();
  const fixed = FIXED[text.toUpperCase()];
  if (fixed) return fixed;

  // Minutes: "67'", "45'+2'", "90+4'".
  if (text.endsWith("'") || text.includes("'+")) {
    const parts = text.split("+").map((p) => p.replace(/\D/g, ""));
    const first = Number(parts[0]);
    if (parts[0] && first > 0) {
      const base = `${ordinal(first)} minute`;
      const added = Number(parts[1]);
      return parts.length > 1 && added > 0 ? `${base} plus ${added}` : base;
    }
  }
  const dash = text.indexOf(" - ");
  if (dash >= 0) return `${text.slice(0, dash)} left in ${spokenPeriod(text.slice(dash + 3))}`;

  // Innings: "Top 5th", "Bot 9th", "Mid 7th", "End 3rd".
  const words = text.split(" ");
  if (words.length === 2 && /^\d/.test(words[1] ?? "")) {
    const half = ({ top: "Top", bot: "Bottom", bottom: "Bottom", mid: "Middle", middle: "Middle", end: "End" } as Record<string, string>)[
      (words[0] ?? "").toLowerCase()
    ];
    if (half) return `${half} of the ${words[1]}`;
  }
  // Finals: "Final/OT", "F/2OT", "Final/10" (extra innings).
  const slash = text.split("/");
  if (slash.length === 2 && ["FINAL", "F"].includes((slash[0] ?? "").toUpperCase())) {
    const extra = slash[1] ?? "";
    const innings = Number(extra);
    return Number.isInteger(innings) && extra !== "" ? `Final, ${innings} innings` : `Final, ${spokenPeriod(extra)}`;
  }
  return text.replaceAll("–", " to ");
}

/** "Arsenal 2, Chelsea 1"; "Arsenal versus Chelsea" before kickoff; a field event's title. */
export function spokenScore(event: ScoreEvent): string {
  if (event.content.kind === "field") return event.content.title;
  const { top, bottom } = event.content;
  if (top.score != null && bottom.score != null) return `${top.name} ${top.score}, ${bottom.name} ${bottom.score}`;
  return `${top.name} versus ${bottom.name}`;
}

/** A finished match's result: "Arsenal won", "Draw" (soccer) or "Tie"; null otherwise. */
export function spokenResult(event: ScoreEvent, sport: Sport | null): string | null {
  if (event.state !== "final" || event.content.kind !== "match") return null;
  const { top, bottom } = event.content;
  if (top.score == null || bottom.score == null) return null;
  if (top.isWinner) return `${top.name} won`;
  if (bottom.isWinner) return `${bottom.name} won`;
  if (top.score !== bottom.score) return null;
  return sport === "soccer" ? "Draw" : "Tie";
}

/** "Score line" for Copy Score: "Arsenal 2–1 Chelsea (67')". */
export function statusLine(event: ScoreEvent, now: number): string {
  const line = scoreLine(event, false);
  switch (event.state) {
    case "live":
      return `${line} (${event.detail ?? "Live"})`;
    case "final":
      return `${line} (${event.detail ?? "Final"})`;
    case "scheduled":
      return `${line}, ${dayAndTime(event.start, now)}`;
  }
}

/** "ARS 2–1 CHE" (abbreviated) or "Arsenal vs Chelsea" before kickoff. */
export function scoreLine(event: ScoreEvent, abbreviated: boolean): string {
  if (event.content.kind === "field") return event.content.title;
  const { top, bottom } = event.content;
  const a = abbreviated ? top.abbreviation : top.name;
  const b = abbreviated ? bottom.abbreviation : bottom.name;
  if (top.score != null && bottom.score != null) return `${a} ${top.score}–${bottom.score} ${b}`;
  return abbreviated ? `${a} v ${b}` : `${a} vs ${b}`;
}

/** The status as a screen reader should say it (Swift `Event.spokenStatus`). */
export function spokenEventStatus(event: ScoreEvent, now: number, clock: string | null = null): string {
  switch (event.state) {
    case "live":
      return spokenStatus(clock ?? event.detail ?? "Live");
    case "final":
      return spokenStatus(event.detail ?? "Final");
    case "scheduled":
      if (event.detail === "Delayed") return "Delayed";
      if (event.start < now) return competitors(event).length === 0 ? "Time to be announced" : "Starting soon";
      return `Starts ${dayAndTime(event.start, now)}`;
  }
}

/** "Arsenal 2, Chelsea 1, Full time, Arsenal won": the base of every row's and tile's label. */
export function spokenSummary(event: ScoreEvent, sport: Sport | null, now: number, clock: string | null = null): string {
  return [spokenScore(event), spokenEventStatus(event, now, clock), spokenResult(event, sport)].filter(Boolean).join(", ");
}

/** "5-1-2" as words: "5 wins, 1 draw, 2 losses" (soccer) or wins, losses, ties. */
export function spokenRecord(record: string, soccer: boolean): string {
  const parts = record.split(/[-–]/);
  if (parts.length < 2 || !parts.every((p) => /^\d+$/.test(p))) return record;
  const count = (n: string, one: string, many: string) => `${n} ${n === "1" ? one : many}`;
  if (soccer && parts.length === 3) {
    return [count(parts[0]!, "win", "wins"), count(parts[1]!, "draw", "draws"), count(parts[2]!, "loss", "losses")].join(", ");
  }
  const spoken = [count(parts[0]!, "win", "wins"), count(parts[1]!, "loss", "losses")];
  if (parts.length === 3) spoken.push(count(parts[2]!, "tie", "ties"));
  return spoken.join(", ");
}

export const TIME = { MINUTE, HOUR, DAY } as const;
