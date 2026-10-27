/**
 * CS2's live rounds (GameDetail.swift `CSDetail.liveState`,
 * ScoreStore.updateCSLive): bo3.gg's snapshot of the map being played, for
 * followed or pinned matches' rows ("Mirage 5–8") and the round race on
 * tiles. Its own module, loaded by the CS2 poll only while a match is live.
 */
import { at, int, str, type JSONValue } from "../json";
import type { Fetcher } from "../http";
import type { CSLive, ScoreEvent } from "../models";

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

/** At most this many live matches get round data for tiles (ScoreStore.tileCSLimit). */
export const TILE_CS_LIMIT = 4;

/**
 * Live matches whose round score is fetched (ScoreStore.csLiveWatch): the
 * ones with a followed team or pinned (their row shows "Mirage 5–8"), plus,
 * while Tiles is the landing view, the first few in the Live tier's order
 * (followed, pinned, then by start), whose tiles race to 13.
 */
export function csLiveWatch(
  events: readonly ScoreEvent[],
  isFollowed: (e: ScoreEvent) => boolean,
  pinnedID: string | null,
  tiles: boolean,
): { listed: Set<string>; watched: Set<string> } {
  const live = events.filter((e) => e.state === "live");
  const listed = new Set(live.filter((e) => isFollowed(e) || e.id === pinnedID).map((e) => e.id));
  if (!tiles) return { listed, watched: new Set(listed) };
  const rank = (e: ScoreEvent) => (isFollowed(e) ? 0 : e.id === pinnedID ? 1 : 2);
  const board = [...live].sort((a, b) => rank(a) - rank(b) || a.start - b.start || (a.id < b.id ? -1 : 1)).slice(0, TILE_CS_LIMIT);
  return { listed, watched: new Set([...listed, ...board.map((e) => e.id)]) };
}

/** "cs-123" → 123. */
const numericID = (id: string | null) => (id?.startsWith("cs-") ? Number(id.slice(3)) || null : null);

/**
 * Round scores for the watched live matches, one small request each; a
 * failure (or a match bo3.gg isn't covering) leaves no race rather than a
 * stale one. Listed rows show "Mirage 5–8" as their status while the map is
 * on (ScoreStore.updateCSLive).
 */
export async function withLiveRounds(
  events: readonly ScoreEvent[],
  watch: { listed: ReadonlySet<string>; watched: ReadonlySet<string> },
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<ScoreEvent[]> {
  const targets = events.filter((e) => e.state === "live" && watch.watched.has(e.id));
  if (targets.length === 0) return [...events];
  const states = new Map<string, CSLive | null>();
  await Promise.all(
    targets.map(async (e) => {
      const id = numericID(e.id);
      if (id == null || e.content.kind !== "match") return;
      try {
        const json = await fetcher(liveSnapshotURL(id), { signal });
        states.set(e.id, parseLive(json, numericID(e.content.top.id), numericID(e.content.bottom.id)));
      } catch {
        states.set(e.id, null);
      }
    }),
  );
  return events.map((e) => {
    if (!states.has(e.id) || e.state !== "live") return e;
    const live = states.get(e.id) ?? null;
    const detail = live && !live.mapEnded && watch.listed.has(e.id) ? csLiveLine(live) : e.detail;
    return { ...e, detail, snapshot: live ? { kind: "counterStrike", live } : null };
  });
}
