/**
 * Lenient JSON readers, the TypeScript twin of the Swift `JSON` wrapper and
 * its `try? decodeIfPresent` habit: every field is read on its own and comes
 * back `undefined` when it's missing or the wrong shape, so an upstream
 * schema tweak drops one field, never the whole feed (Providers.swift,
 * "decoding is deliberately lenient").
 *
 *     const name = str(at(team, "shortDisplayName")) ?? str(at(team, "displayName")) ?? "TBD";
 *
 * Never `as` a response into a type: read it through these.
 */

export type JSONValue = unknown;

/** `value[k0][k1]…`, or undefined as soon as a step is missing. Numbers index arrays. */
export function at(value: JSONValue, ...path: (string | number)[]): JSONValue {
  let current: unknown = value;
  for (const key of path) {
    if (current == null) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (typeof current !== "object" || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

/** A non-empty-or-empty string; numbers are not coerced (ESPN sends ids as strings). */
export function str(value: JSONValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A string that isn't empty. */
export function text(value: JSONValue): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function num(value: JSONValue): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An integer; a whole-number float counts (JSONSerialization's `int`). */
export function int(value: JSONValue): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export function bool(value: JSONValue): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** An array, or empty (Swift's `json["x"].array`). */
export function arr(value: JSONValue): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** True when the key is present at all (Swift's `.exists`). */
export function has(value: JSONValue, key: string): boolean {
  return value != null && typeof value === "object" && !Array.isArray(value) && key in value;
}
