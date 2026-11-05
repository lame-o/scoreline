/**
 * ESPN's plays in game order on the wall clock (MatchHistory.swift
 * `chronology`, `placed`, `inOrder`, `rawPlays`), shared by the timeline's
 * history (history.ts) and the odds chart's ESPN half (espn.ts
 * `parseOddsBasis`), so a corrected timestamp moves the market's ESPN model
 * and the timeline's event by exactly the same amount. Times are epoch ms.
 *
 * Reads the summary through the Swift `JSON` wrapper's coercions
 * (profiles/read.ts): `.string` takes a number, `.int` a numeric string.
 */
import type { Sport } from "../models";
import { parseDate } from "../providers/espn";
import { arr, at, i, s, type JSONValue } from "../profiles/read";

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => v != null && typeof v === "object" && !Array.isArray(v);

/** A play from the summary and when it happened (MatchHistory.PlacedPlay). */
export interface PlacedPlay {
  readonly json: JSONValue;
  readonly t: number;
}

/** DateParser.parse: ISO 8601 with or without seconds and fraction; null when it isn't a date. */
export function wallclock(play: JSONValue): number | null {
  const t = parseDate(s(at(play, "wallclock")) ?? undefined);
  return t != null && Number.isFinite(t) ? t : null;
}

/**
 * The plays in game order on the wall clock. Stamps run backwards now and
 * then, because one play was logged late (14 of 552 in GSW at MIN). The
 * longest run of stamps in order stands as reported; a play out of it goes as
 * near its own stamp as its neighbors allow, so one late stamp never drags
 * the plays after it to its time.
 */
export function chronology(summary: JSONValue, sport: Sport): PlacedPlay[] {
  const dated: { json: JSONValue; t: number }[] = [];
  for (const play of rawPlays(summary, sport)) {
    const t = wallclock(play);
    if (t != null) dated.push({ json: play, t });
  }
  const times = placed(dated.map((d) => d.t));
  return dated.map((d, k) => ({ json: d.json, t: times[k]! }));
}

/** Each stamp, moved only as far as staying in order needs. (pure; tested) */
export function placed(stamps: readonly number[]): number[] {
  const kept = inOrder(stamps);
  const times = [...stamps];
  let previous = -Infinity;
  for (let index = 0; index < stamps.length; index++) {
    if (kept[index]) {
      previous = stamps[index]!;
    } else {
      let next = Infinity;
      for (let j = index + 1; j < stamps.length; j++) {
        if (kept[j]) {
          next = stamps[j]!;
          break;
        }
      }
      times[index] = Math.min(Math.max(stamps[index]!, previous), next);
      previous = times[index]!;
    }
  }
  return times;
}

/** Which stamps are in the longest run in order. Between runs of the same length, the earlier play stands. (pure; tested) */
export function inOrder(stamps: readonly number[]): boolean[] {
  // Patience sorting from the end: `tails[k]` is the index ending the
  // best run of length k + 1, read forwards from there.
  const tails: number[] = [];
  const next = new Array<number>(stamps.length).fill(-1);
  for (let index = stamps.length - 1; index >= 0; index--) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (stamps[tails[mid]!]! >= stamps[index]!) lo = mid + 1;
      else hi = mid;
    }
    next[index] = lo > 0 ? tails[lo - 1]! : -1;
    if (lo === tails.length) tails.push(index);
    else tails[lo] = index;
  }
  const kept = new Array<boolean>(stamps.length).fill(false);
  let index = tails.at(-1) ?? -1;
  while (index >= 0) {
    kept[index] = true;
    index = next[index]!;
  }
  return kept;
}

/**
 * Deduplicate the drive/current-drive overlap and enrich commentary by play
 * ID with key-event fields (team, goal/card type). Supplemental events
 * without commentary keep their actual timestamp.
 */
export function rawPlays(summary: JSONValue, sport: Sport): JSONValue[] {
  let main: readonly JSONValue[];
  switch (sport) {
    case "football": {
      const drives = [...arr(at(summary, "drives", "previous")).flatMap((d) => arr(at(d, "plays"))), ...arr(at(summary, "drives", "current", "plays"))];
      main = drives.length === 0 ? arr(at(summary, "plays")) : drives;
      break;
    }
    case "soccer":
      main = arr(at(summary, "commentary")).flatMap((c) => {
        const play = at(c, "play");
        if (!isDict(play)) return [];
        const text = s(at(c, "text"));
        return [text != null ? { ...play, text } : play];
      });
      break;
    default:
      main = arr(at(summary, "plays"));
  }
  let plays: JSONValue[] = [];
  const indices = new Map<string, number>();
  const add = (play: JSONValue, supplemental: boolean) => {
    const id = identity(play, sport);
    const i = indices.get(id);
    if (i != null) {
      const old = plays[i];
      if (isDict(old) && isDict(play)) plays[i] = merge(old, play, supplemental);
    } else {
      indices.set(id, plays.length);
      plays.push(play);
    }
  };
  for (const play of main) add(play, false);
  const mainCount = plays.length;
  for (const play of [...arr(at(summary, "keyEvents")), ...arr(at(summary, "scoringPlays"))]) add(play, true);
  if (sport === "soccer") {
    // ESPN commentary can arrive newest-first. Wall time is the
    // relevant axis; array position and sequence IDs are not clocks.
    return plays
      .map((play, offset) => ({ play, offset, t: wallclock(play) ?? Infinity }))
      .sort((a, b) => (a.t !== b.t ? a.t - b.t : a.offset - b.offset))
      .map((x) => x.play);
  }
  // Other sports' array order is authoritative. Insert independently
  // supplied scoring plays into it before clamping regressed stamps.
  const extra = plays.slice(mainCount);
  plays = plays.slice(0, mainCount);
  for (const play of extra) {
    const t = wallclock(play);
    const i = t == null ? -1 : plays.findIndex((p) => (wallclock(p) ?? -Infinity) > t);
    if (i >= 0) plays.splice(i, 0, play);
    else plays.push(play);
  }
  return plays;
}

/** Swift's `old.merging(new)`: nested dictionaries merge; an empty or null old value takes the new; else supplemental keeps the old. */
function merge(old: Dict, next: Dict, supplemental: boolean): Dict {
  const out: Dict = { ...old };
  for (const [key, b] of Object.entries(next)) {
    if (!(key in old)) {
      out[key] = b;
      continue;
    }
    const a = old[key];
    if (isDict(a) && isDict(b)) out[key] = merge(a, b, supplemental);
    else if (a === null || a === "") out[key] = b;
    else out[key] = supplemental ? a : b;
  }
  return out;
}

/** A play's ID, or one stable across polls for malformed rows without provider IDs. */
export function identity(p: JSONValue, sport: Sport): string {
  const id = s(at(p, "id"));
  if (id) return id;
  const fields = [
    sport,
    s(at(p, "wallclock")) ?? "",
    s(at(p, "period", "number")) ?? "",
    s(at(p, "clock", "displayValue")) ?? "",
    s(at(p, "type", "type")) ?? "",
    s(at(p, "text")) ?? s(at(p, "shortText")) ?? "",
  ];
  return `history:${fields.join("|")}`;
}

/** `p["period"]["number"].int`. */
export const periodNumber = (p: JSONValue): number | null => i(at(p, "period", "number"));
