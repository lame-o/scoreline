/**
 * The Swift `JSON` wrapper's coercions, for the profile parsers
 * (GameDetail.swift `JSON`): `.string` takes a number too, `.double` takes a
 * numeric string, `.int` truncates either. Profile sources mix the two
 * freely (bo3 IDs are numbers, FotMob's search sends them as strings, ESPN
 * sends some counts as strings), and the Swift parsers lean on that.
 *
 * Use `json.ts`'s strict readers everywhere else; these exist so a port reads
 * exactly as its Swift original.
 */
import { at, type JSONValue } from "../json";

export { at, arr, has, type JSONValue } from "../json";

/** `.string`: a string, or a number as text. */
export function s(value: JSONValue): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** `.double`: a number, or a numeric string. */
export function d(value: JSONValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `.int`: `.double` truncated toward zero. */
export function i(value: JSONValue): number | null {
  const n = d(value);
  return n == null ? null : Math.trunc(n);
}

/** `.bool`: a boolean (or 0/1, as NSNumber reads). */
export function b(value: JSONValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}

/** `.exists`: present and not null. */
export function exists(value: JSONValue): boolean {
  return value !== undefined && value !== null;
}

/** An object's own entries (Swift's `raw as? [String: Any]`), or none. */
export function entries(value: JSONValue): [string, unknown][] {
  return value != null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
}

/** A string that isn't empty, or null (Swift's `nilIfEmpty`). */
export function nonEmpty(value: string | null | undefined): string | null {
  return value ? value : null;
}

/** "Sprained ankle" from "sprained ankle" (`capitalizedFirst`). */
export function capitalizedFirst(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

/** Swift's `.capitalized`: every word's first letter up, the rest down. */
export function capitalized(value: string): string {
  return value.replace(/\S+/g, (w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase());
}

// MARK: - Dates (ProfileProviders.swift `ProfileParse`)

/** ISO timestamps (with or without seconds), or plain dates ("1999-03-12", read as UTC midnight). */
export function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  let v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += "T00:00:00Z";
  else if (/T\d{2}:\d{2}(Z|[+-]\d{2}:?\d{2})$/.test(v)) v = v.replace(/T(\d{2}:\d{2})/, "T$1:00");
  const ms = Date.parse(v.replace(" UTC", "Z"));
  if (!Number.isNaN(ms)) return ms;
  // A prefix that is a date ("2026-10-25 …").
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return day ? Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : null;
}

const ZONES: Readonly<Record<string, number>> = {
  UTC: 0, GMT: 0, EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8, AKDT: -8, AKST: -9, HST: -10,
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RotoWire's "Sun Oct 25 10:06:18 PDT 2026". */
export function rotowireDate(value: string | null | undefined): number | null {
  const m = value ? /^\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) ([A-Z]{3,4}) (\d{4})$/.exec(value.trim()) : null;
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!);
  const offset = ZONES[m[6]!];
  if (month < 0 || offset == null) return null;
  return Date.UTC(Number(m[7]), month, Number(m[2]), Number(m[3]) - offset, Number(m[4]), Number(m[5]));
}

/** The athlete ID in a core `$ref` ("…/athletes/3945274?lang=en"). */
export function refID(ref: string | null | undefined, kind = "athletes"): string | null {
  if (!ref) return null;
  const marker = `/${kind}/`;
  const start = ref.indexOf(marker);
  if (start < 0) return null;
  const id = /^\d+/.exec(ref.slice(start + marker.length))?.[0];
  return id ?? null;
}

/** Labels lose stray whitespace (kicker labels carry tabs). */
export function label(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** A field read as a string, through a path. */
export function sAt(value: JSONValue, ...path: (string | number)[]): string | null {
  return s(at(value, ...path));
}
