/**
 * College football's polls: the AP Top 25 and the Coaches Poll (College.swift
 * `Poll`, `Rankings`). Conference tables live in standings.ts; the
 * conference order (`POWER_FOUR`) in providers/teams.ts.
 *
 * ESPN's rankings feed lists every division's polls (FCS, Division II and
 * III). Only the FBS polls show: the Mac's picker would otherwise read
 * "Coaches" four times.
 */
import { arr, at, int, num, str, type JSONValue } from "./json";
import type { Fetcher } from "./http";
import { espnTeamID } from "./teams";

export interface PollEntry {
  readonly rank: number;
  /** Last week's rank; null when the team wasn't ranked. */
  readonly previous: number | null;
  readonly teamID: string;
  readonly name: string;
  readonly logo: string | null;
  readonly record: string | null;
  readonly points: number | null;
  readonly firstPlaceVotes: number | null;
}

export interface Poll {
  /** "AP Top 25" */
  readonly name: string;
  /** "AP Poll: Week 9" */
  readonly headline: string | null;
  readonly entries: readonly PollEntry[];
}

/** Places gained since last week (negative: lost); null when it's new. */
export function movement(e: PollEntry): number | null {
  return e.previous != null ? e.previous - e.rank : null;
}

export function rankingsURL(path: string): string {
  return `https://site.api.espn.com/apis/site/v2/sports/${path}/rankings`;
}

/** The FBS polls: not FCS, nor Division II or III. */
export function isFBSPoll(name: string): boolean {
  return !/\bFCS\b|Division|Div\b|NAIA/i.test(name);
}

export function parseRankings(json: JSONValue, path: string): Poll[] {
  return arr(at(json, "rankings")).flatMap((poll): Poll[] => {
    const name = str(at(poll, "name"));
    if (!name || !isFBSPoll(name)) return [];
    const entries = arr(at(poll, "ranks")).flatMap((r): PollEntry[] => {
      const rank = int(at(r, "current"));
      const id = str(at(r, "team", "id"));
      if (rank == null || !id) return [];
      const previous = int(at(r, "previous"));
      const points = num(at(r, "points"));
      return [
        {
          rank,
          previous: previous != null && previous > 0 ? previous : null,
          teamID: espnTeamID(path, "football", id),
          name: str(at(r, "team", "location")) ?? str(at(r, "team", "name")) ?? "",
          logo: str(at(r, "team", "logos", 0, "href")) ?? str(at(r, "team", "logo")) ?? null,
          record: str(at(r, "recordSummary")) ?? null,
          points: points != null ? Math.trunc(points) : null,
          firstPlaceVotes: int(at(r, "firstPlaceVotes")) ?? null,
        },
      ];
    });
    return entries.length === 0 ? [] : [{ name, headline: str(at(poll, "shortHeadline")) ?? null, entries }];
  });
}

export async function fetchRankings(path: string, fetcher: Fetcher, signal?: AbortSignal): Promise<Poll[]> {
  return parseRankings(await fetcher(rankingsURL(path), { signal }), path);
}

/** "AP Top 25" → "AP", "AFCA Coaches Poll" → "Coaches". */
export function pollLabel(name: string): string {
  return name.includes("Coaches") ? "Coaches" : name.replace(" Top 25", "");
}

/** "1,681 (10)": points, first-place votes in parentheses. */
export function pollPoints(e: PollEntry): string | null {
  if (e.points == null) return null;
  const votes = e.firstPlaceVotes != null && e.firstPlaceVotes > 0 ? ` (${e.firstPlaceVotes})` : "";
  return `${e.points.toLocaleString()}${votes}`;
}

export function spokenPollEntry(e: PollEntry): string {
  const m = movement(e);
  const move = e.previous == null ? "new this week" : m == null ? "" : m > 0 ? `up ${m}` : m < 0 ? `down ${-m}` : "unchanged";
  return [`Number ${e.rank}`, e.name, e.record, move, e.points != null ? `${e.points} points` : null, e.firstPlaceVotes ? `${e.firstPlaceVotes} first-place votes` : null]
    .filter(Boolean)
    .join(", ");
}

/** Team ID → AP rank, for the conference tables. */
export function apRanks(polls: readonly Poll[]): Record<string, number> {
  const ap = polls[0];
  const out: Record<string, number> = {};
  for (const e of ap?.entries ?? []) if (!(e.teamID in out)) out[e.teamID] = e.rank;
  return out;
}

/** Rows per column when a ranked list reads down each column (1–13, 14–25). */
export function perColumn(count: number, columns: number): number {
  const c = Math.max(columns, 1);
  return Math.ceil(count / c);
}
