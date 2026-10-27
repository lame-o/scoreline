/**
 * Counter-Strike 2 from bo3.gg, S-tier only (Providers.swift `CounterStrike`).
 *
 * `TIER` is the one constant every bo3.gg query uses: scores, schedules,
 * tournaments, results, team pages. There is no tier setting and there must
 * never be one (the owner only follows S-tier).
 */
import { arr, at, int, str, type JSONValue } from "../json";
import type { Fetcher } from "../http";
import type { Competitor, CSLive, EventState, ScoreEvent } from "../models";
import { parseDate } from "./espn";

/** bo3.gg's `tier` filter value. S-tier only, everywhere. */
export const TIER = "s";

const MATCHES = "https://api.bo3.gg/api/v1/matches";
const HOUR = 3_600_000;

/**
 * A match list. `after`/`before` bound the start date, so a match postponed
 * months ago (or canceled far ahead) can't take a slot.
 *
 * Web addition: the bounds are rounded down to the hour. Swift sends the
 * exact second, which would give every poll a new URL and defeat the edge
 * cache; an hour is nothing against a two-day window.
 */
export function listURL(status: string, sort: string, limit: number, bounds: { after?: number; before?: number } = {}): string {
  const url = new URL(MATCHES);
  url.searchParams.set("filter[matches.discipline_id][eq]", "1");
  url.searchParams.set("filter[matches.status][in]", status);
  url.searchParams.set("filter[matches.tier][in]", TIER);
  url.searchParams.set("sort", sort);
  url.searchParams.set("page[limit]", String(limit));
  url.searchParams.set("with", "teams,tournament");
  const hour = (ms: number) => new Date(Math.floor(ms / HOUR) * HOUR).toISOString().replace(".000Z", "Z");
  if (bounds.after != null) url.searchParams.set("filter[matches.start_date][gte]", hour(bounds.after));
  if (bounds.before != null) url.searchParams.set("filter[matches.start_date][lte]", hour(bounds.before));
  return url.href;
}

/** The three lists the scores read: live, upcoming (with postponed) and finished (with forfeits and cancellations). */
export function scoreURLs(now: number): { live: string; upcoming: string; finished: string } {
  return {
    live: listURL("current", "start_date", 20),
    // Postponed matches stay with the upcoming ones and canceled ones with
    // the results, each saying so, instead of silently vanishing.
    upcoming: listURL("upcoming,postponed", "start_date", 12, { after: now - 48 * HOUR }),
    finished: listURL("finished,defwin,canceled", "-start_date", 12, { before: now + 48 * HOUR }),
  };
}

export async function fetchCounterStrike(fetcher: Fetcher, signal?: AbortSignal): Promise<ScoreEvent[]> {
  const urls = scoreURLs(Date.now());
  const [live, upcoming, finished] = await Promise.all([fetcher(urls.live, { signal }), fetcher(urls.upcoming, { signal }), fetcher(urls.finished, { signal })]);
  return parseMatchLists([live, upcoming, finished]);
}

/** Events from the three lists. A match changing state can be cached in two lists at once: keep one, preferring the live copy. */
export function parseMatchLists(pages: readonly JSONValue[]): ScoreEvent[] {
  const byID = new Map<number, JSONValue>();
  for (const match of pages.flatMap((p) => arr(at(p, "results")))) {
    const id = int(at(match, "id"));
    if (id == null) continue;
    if (!byID.has(id) || str(at(match, "status")) === "current") byID.set(id, match);
  }
  return [...byID.values()].flatMap((m) => makeMatchEvent(m) ?? []);
}

/**
 * A short name for tight spaces: "G2", "FaZe" and "MOUZ" stay; "Natus
 * Vincere" → "NV"; "The MongolZ" → "MON"; "Team Spirit" → "SPI".
 */
export function abbreviate(name: string): string {
  const filler = new Set(["the", "team", "esports", "gaming", "club", "cs", "cs2", "academy"]);
  // Words, not decoration: "🐺 Wolves Esports" is "WOL", never "🐺W".
  const words = name.split(/[ .]/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const core = words.filter((w) => !filler.has(w.toLowerCase()));
  const kept = core.length > 0 ? core : words;
  if (kept.length >= 2) return kept.slice(0, 3).map((w) => [...w][0]).join("").toUpperCase();
  const word = kept[0] ?? name;
  return [...word].length <= 5 ? word : [...word].slice(0, 3).join("").toUpperCase();
}

export function makeMatchEvent(m: JSONValue): ScoreEvent | null {
  const id = int(at(m, "id"));
  const start = parseDate(str(at(m, "start_date")));
  const team1 = at(m, "team1");
  const team2 = at(m, "team2");
  // Unseeded bracket slots ("TBD vs TBD") are noise.
  if (id == null || start == null || (team1 == null && team2 == null)) return null;

  const status = str(at(m, "status"));
  // Canceled and postponed matches aren't upcoming: like ESPN's postponed
  // games they're over for now, without a score (so no "Final" alert).
  const called = status === "canceled" || status === "postponed";
  const state: EventState =
    status === "current" ? "live" : status === "finished" || status === "defwin" || status === "canceled" || status === "postponed" ? "final" : "scheduled";
  const winnerID = int(at(m, "winner_team_id"));

  const competitor = (team: JSONValue, score: number | undefined): Competitor => {
    const teamID = int(at(team, "id"));
    const name = str(at(team, "name")) ?? "TBD";
    return {
      id: teamID != null ? `cs-${teamID}` : null,
      name,
      abbreviation: abbreviate(name),
      score: state === "scheduled" || called ? null : String(score ?? 0),
      logo: str(at(team, "image_url")) ?? null,
      isWinner: !called && team != null && teamID != null && teamID === winnerID,
      color: null,
      rank: null,
      record: null,
      conferenceRecord: null,
      alternateColor: null,
    };
  };

  const s1 = int(at(m, "team1_score"));
  const s2 = int(at(m, "team2_score"));
  const bo = int(at(m, "bo_type"));
  let detail: string | null;
  if (state === "live") detail = `Map ${(s1 ?? 0) + (s2 ?? 0) + 1}${bo != null ? ` of ${bo}` : ""}`;
  else if (status === "canceled") detail = "Canceled";
  else if (status === "postponed") detail = "Postponed";
  else if (status === "defwin") detail = "Forfeit";
  else if (state === "final") detail = "Final";
  else detail = null;

  const tournament = str(at(m, "tournament", "name")) ?? null;
  const slug = str(at(m, "slug"));
  return {
    id: `cs-${id}`,
    content: { kind: "match", top: competitor(team1, s1), bottom: competitor(team2, s2) },
    state,
    start,
    detail,
    caption: [tournament, bo != null ? `Best of ${bo}` : null].filter(Boolean).join(" · ") || null,
    link: slug ? `https://bo3.gg/matches/${slug}` : null,
    ref: slug ? { kind: "counterStrike", slug, tournament } : null,
    stage: null,
    clock: null,
    possession: null,
    liveLine: null,
    liveLineRoutine: false,
    broadcast: null,
    venue: null,
    snapshot: null,
  };
}

// MARK: - Live rounds (GameDetail.swift `CSDetail.liveState`, ScoreStore.updateCSLive)

/** bo3.gg's live snapshot of a match: the map being played, round by round. A 404 when bo3.gg isn't covering it. */
export function liveSnapshotURL(matchID: number): string {
  return `https://api.bo3.gg/api/v1/live/matches/${matchID}/last_snapshot?discipline_id=1`;
}

const MAPS: Readonly<Record<string, string>> = {
  de_dust2: "Dust II",
  de_mirage: "Mirage",
  de_inferno: "Inferno",
  de_nuke: "Nuke",
  de_ancient: "Ancient",
  de_anubis: "Anubis",
  de_vertigo: "Vertigo",
  de_train: "Train",
  de_overpass: "Overpass",
  de_cache: "Cache",
};

/** "de_mirage" → "Mirage"; an unknown map loses its prefix and is capitalized (CSDetail.mapName). */
export function mapName(raw: string | null | undefined): string {
  if (!raw) return "TBD";
  const known = MAPS[raw];
  if (known) return known;
  return raw.replace("de_", "").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * The live snapshot, oriented to the event's teams (CSDetail.parseLive).
 * `team_one` is whoever bo3.gg's feed lists first, not necessarily team1:
 * the fixture's team IDs decide. Null without both scores.
 */
export function parseLive(json: JSONValue, topTeamID: number | null, bottomTeamID: number | null): CSLive | null {
  const one = at(json, "team_one");
  const two = at(json, "team_two");
  const oneScore = int(at(one, "score"));
  const twoScore = int(at(two, "score"));
  if (oneScore == null || twoScore == null) return null;
  const oneID = int(at(one, "fixture", "team_id"));
  const twoID = int(at(two, "fixture", "team_id"));
  const swapped = (oneID != null && oneID === bottomTeamID) || (twoID != null && twoID === topTeamID);
  const [top, bottom] = swapped ? [two, one] : [one, two];
  const side = (team: JSONValue): "CT" | "T" | null => {
    const raw = str(at(team, "side"))?.toLowerCase();
    return raw?.startsWith("c") ? "CT" : raw?.startsWith("t") ? "T" : null;
  };
  const rawMap = str(at(json, "map_name"));
  return {
    mapName: rawMap ? mapName(rawMap) : null,
    mapNumber: int(at(json, "game_number")) ?? null,
    round: int(at(json, "round_number")) ?? null,
    topScore: swapped ? twoScore : oneScore,
    bottomScore: swapped ? oneScore : twoScore,
    topSide: side(top),
    bottomSide: side(bottom),
    mapEnded: at(json, "game_ended") === true,
  };
}

/** "Mirage 5–8", a list row's live status (top team first). */
export function csLiveLine(live: CSLive): string {
  return [live.mapName, `${live.topScore}–${live.bottomScore}`].filter(Boolean).join(" ");
}
