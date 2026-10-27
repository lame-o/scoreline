/**
 * A CS2 match's page, from bo3.gg, S-tier only (GameDetail.swift `CSDetail`;
 * the rules from LiveViews.swift `RoundHistoryView` and CelebrateMatch.swift
 * `MatchRules`; DetailView.swift's streams and maps captions).
 *
 * - The match with its games and streams, both rosters, each started map's
 *   rounds (finished maps are cached: they never change), and while live,
 *   bo3.gg's last snapshot of the map being played (`parseLive`, shared with
 *   the scores list in providers/counterStrike.ts).
 * - The rules the page draws: who's on map point (13, then 16, 19… in
 *   overtime), the series, rounds won and maps won as moments, the round
 *   grid's halves and overtimes, rounds the live score has but the round
 *   list doesn't yet.
 * - Streams: bo3.gg's list, official first, then English, then most watched,
 *   on Twitch, YouTube and Kick only (anything else is never linked).
 *
 *     const part = await loadCSDetail(slug, event, getJSON);
 */
import { arr, at, bool, int, str, type JSONValue } from "./json";
import type { Fetcher } from "./http";
import type { DetailOptions, MapResult, Stream, Tournament } from "./gameDetail";
import { liveMoment, Tier, type LiveMoment } from "./moments";
import type { CSLive, ScoreEvent, Side } from "./models";
import { liveSnapshotURL, makeMatchEvent, mapName, parseLive, TIER } from "./providers/counterStrike";
import { flagFromISO } from "./teams";

const BO3 = "https://api.bo3.gg/api/v1";

// MARK: - Model

/** A player on a CS2 roster (GameDetail.Player). */
export interface CSPlayer {
  readonly id: number;
  readonly nickname: string;
  readonly realName: string | null;
  /** ISO 3166 alpha-2 ("FR"), for the flag and the player page. */
  readonly country: string | null;
  readonly flag: string | null;
  readonly photo: string | null;
  /** bo3.gg's player slug, for the player page. */
  readonly slug: string | null;
}

/** The five active players and the coach (bench and former players excluded) (GameDetail.Roster). */
export interface Roster {
  readonly players: readonly CSPlayer[];
  readonly coach: CSPlayer | null;
  /** The team's own short name on bo3.gg ("VIT", "MGZ"). */
  readonly acronym: string | null;
}

export const EMPTY_ROSTER: Roster = { players: [], coach: null, acronym: null };
export const rosterIsEmpty = (r: Roster): boolean => r.players.length === 0 && r.coach == null;

export type RoundReason = "elimination" | "bombed" | "defused" | "time";

/** One round: who won, from which side, how, and what each team spent (GameDetail.CSRound). */
export interface CSRound {
  readonly number: number;
  readonly winner: Side | null;
  /** "CT" or "T". */
  readonly winnerSide: string | null;
  readonly reason: RoundReason;
  readonly topEquipment: number | null;
  readonly bottomEquipment: number | null;
}

/** What a CS2 match adds to the game page's detail. */
export interface CSDetailPart {
  readonly roundName: string | null;
  readonly tournament: Tournament | null;
  readonly maps: readonly MapResult[];
  readonly streams: readonly Stream[];
  readonly topRoster: Roster;
  readonly bottomRoster: Roster;
  /** Round history per map number. */
  readonly rounds: Readonly<Record<number, readonly CSRound[]>>;
  readonly csLive: CSLive | null;
}

// MARK: - URLs

export const matchURL = (slug: string) => `${BO3}/matches/${slug}?with=games,streams`;
export const gameURL = (id: number) => `${BO3}/games/${id}`;
/** The same URL the team page reads (data/profiles/bo3.ts `teamURL`), so the edge serves both. */
export const rosterURL = (slug: string) => `${BO3}/teams/${slug}?with=players.country`;
/** One match by its numeric ID, for a page opened off the scoreboards (`/game/cs-132237`). */
export function matchByIDURL(id: number): string {
  const url = new URL(`${BO3}/matches`);
  url.searchParams.set("filter[matches.id][eq]", String(id));
  url.searchParams.set("filter[matches.tier][in]", TIER);
  url.searchParams.set("with", "teams,tournament");
  return url.href;
}

/** "cs-132237" → 132237. */
export const matchNumber = (eventID: string): number | null => (eventID.startsWith("cs-") ? Number(eventID.slice(3)) || null : null);
const teamNumber = (id: string | null): number | null => (id?.startsWith("cs-") ? Number(id.slice(3)) || null : null);

// MARK: - The match

interface Team {
  readonly id: number | null;
  readonly name: string;
  readonly slug: string | null;
}

export interface ParsedMatch {
  readonly id: number | null;
  readonly top: Team;
  readonly bottom: Team;
  readonly roundName: string | null;
  readonly tournament: Tournament | null;
  readonly maps: readonly MapResult[];
  readonly streams: readonly Stream[];
  readonly games: readonly JSONValue[];
}

/** The match record: its maps, streams and tournament, in the event's top/bottom order (team1 is top). */
export function parseMatch(match: JSONValue): ParsedMatch {
  const team = (key: "team1" | "team2"): Team => ({
    id: int(at(match, key, "id")) ?? int(at(match, `${key}_id`)) ?? null,
    name: str(at(match, key, "name")) ?? "",
    slug: str(at(match, key, "slug")) ?? null,
  });
  const top = team("team1");
  const bottom = team("team2");
  const side = (id: number | undefined): Side | null => (id == null ? null : id === top.id ? "top" : id === bottom.id ? "bottom" : null);

  let tournament: Tournament | null = null;
  const slug = str(at(match, "tournament", "slug"));
  if (slug) {
    const name = str(at(match, "tournament", "name")) ?? slug;
    // "PGL Masters Bucharest 2026 Group Stage" → "Group Stage".
    const stage = str(at(match, "stage", "title"))?.replaceAll(name, "").trim();
    const parts = [stage, str(at(match, "round", "name"))].filter((p): p is string => !!p);
    tournament = { slug, name, stage: parts.length > 0 ? parts.join(" · ") : null };
  }

  const games = arr(at(match, "games"));
  const maps = games
    .flatMap((game): MapResult[] => {
      const number = int(at(game, "number"));
      if (number == null) return [];
      const winnerSide = side(int(at(game, "winner_team_clan", "team_id")));
      const w = int(at(game, "winner_clan_score")) ?? null;
      const l = int(at(game, "loser_clan_score")) ?? null;
      const status = str(at(game, "status")) ?? "";
      const finished = status === "finished" || str(at(game, "state")) === "done";
      return [
        {
          number,
          name: mapName(str(at(game, "map_name"))),
          topScore: winnerSide === "bottom" ? l : w,
          bottomScore: winnerSide === "bottom" ? w : l,
          winner: finished ? winnerSide : null,
          live: !finished && status !== "upcoming" && status !== "defwin",
        },
      ];
    })
    .sort((a, b) => a.number - b.number);

  return {
    id: int(at(match, "id")) ?? null,
    top,
    bottom,
    roundName: str(at(match, "stage", "name")) ?? null,
    tournament,
    maps,
    streams: orderStreams(parseStreams(at(match, "streams"))),
    games,
  };
}

// MARK: - Streams

export type Platform = "twitch" | "youtube" | "kick";

/** Where a stream lives; null for anywhere else, which is never linked. */
export function platform(url: string): Platform | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("twitch.tv")) return "twitch";
  if (on("youtube.com") || on("youtu.be")) return "youtube";
  if (on("kick.com")) return "kick";
  return null;
}

export const PLATFORM_NAME: Readonly<Record<Platform, string>> = { twitch: "Twitch", youtube: "YouTube", kick: "Kick" };

/**
 * bo3.gg's streams for the match. Web addition: only https links on Twitch,
 * YouTube and Kick, the platforms the Mac draws a glyph for; anything else
 * bo3.gg might list is dropped rather than linked.
 */
export function parseStreams(json: JSONValue): Stream[] {
  return arr(json).flatMap((s): Stream[] => {
    const id = int(at(s, "id"));
    const raw = str(at(s, "raw_url"));
    if (id == null || !raw || !raw.startsWith("https://") || platform(raw) == null) return [];
    const last = raw.replace(/\/+$/, "").split("/").pop() ?? raw;
    return [{ id, name: str(at(s, "name")) || last, url: raw, viewers: int(at(s, "viewers_number")) ?? 0, official: bool(at(s, "official")) ?? false, language: str(at(s, "language")) ?? null }];
  });
}

/** Official broadcasts first, then English, then most watched. */
export function orderStreams(streams: readonly Stream[]): Stream[] {
  return [...streams].sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    const ae = a.language === "en";
    const be = b.language === "en";
    if (ae !== be) return ae ? -1 : 1;
    return b.viewers - a.viewers;
  });
}

/** "241K watching"; nothing for nobody. */
export function viewers(n: number): string | null {
  if (n <= 0) return null;
  return `${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)} watching`;
}

/**
 * Whether bo3.gg lists the co-streamer's own Twitch channel among the
 * match's streams (ScoreStore.noteStreams): the exact channel, so
 * "99damage" never matches "99damage2".
 */
export function coStreamListed(streams: readonly Stream[], handle: string): boolean {
  const wanted = handle.trim().toLowerCase();
  if (!wanted) return false;
  return streams.some((s) => {
    if (platform(s.url) !== "twitch") return false;
    try {
      return new URL(s.url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() === wanted;
    } catch {
      return false;
    }
  });
}

/** "ohnePixel" for the default, else the handle as typed (ScoreStore.coStreamerName). */
export const coStreamerName = (handle: string): string => (handle.trim().toLowerCase() === "ohnepixel" ? "ohnePixel" : handle.trim());
export const coStreamerURL = (handle: string): string | null => {
  const h = handle.trim().toLowerCase();
  return /^[a-z0-9_]{2,25}$/.test(h) ? `https://www.twitch.tv/${h}` : null;
};

// MARK: - Rosters

/** A team's active five and its coach: bo3.gg marks benched and former members with `status` 2, coaches with `is_coach` (CSDetail.roster). */
export function parseRoster(team: JSONValue): Roster {
  const acronym = str(at(team, "acronym")) || null;
  const players: CSPlayer[] = [];
  let coach: CSPlayer | null = null;
  for (const p of arr(at(team, "players"))) {
    if (int(at(p, "status")) !== 1) continue;
    const id = int(at(p, "id"));
    const nickname = str(at(p, "nickname"));
    if (id == null || !nickname) continue;
    const name = [str(at(p, "first_name")), str(at(p, "last_name"))].filter(Boolean).join(" ");
    const country = str(at(p, "country", "code"))?.toUpperCase() ?? null;
    const player: CSPlayer = { id, nickname, realName: name || null, country, flag: flagFromISO(country), photo: str(at(p, "image_url")) ?? null, slug: str(at(p, "slug")) ?? null };
    if (bool(at(p, "is_coach")) === true) {
      coach ??= player;
    } else if (players.length < 5) {
      players.push(player);
    }
  }
  return { players, coach, acronym };
}

// MARK: - Rounds

/** The maps that have started (their round lists exist): finished ones never change. */
export function startedGames(games: readonly JSONValue[]): { id: number; number: number; finished: boolean }[] {
  return games.flatMap((g) => {
    const id = int(at(g, "id"));
    const number = int(at(g, "number"));
    const status = str(at(g, "status"));
    if (id == null || number == null || !status || status === "upcoming" || status === "defwin") return [];
    return [{ id, number, finished: status === "finished" }];
  });
}

/**
 * A map's rounds, oriented to the match. Clan names ("G2 Esports") can
 * differ from team names ("G2"): the game's winner and loser clans carry team
 * IDs, with a name match as the fallback (CSDetail.parseRounds).
 */
export function parseRounds(game: JSONValue, top: { id: number | null; name: string }, bottom: { id: number | null; name: string }): CSRound[] {
  const clans = new Map<string, Side>();
  for (const key of ["winner_team_clan", "loser_team_clan"]) {
    const clan = at(game, key);
    const name = str(at(clan, "clan_name"));
    if (!name) continue;
    const id = int(at(clan, "team_id"));
    if (id != null && id === top.id) clans.set(name, "top");
    if (id != null && id === bottom.id) clans.set(name, "bottom");
  }
  const side = (clan: string | undefined): Side | null => {
    if (!clan) return null;
    const known = clans.get(clan);
    if (known) return known;
    const c = clan.toLowerCase();
    const t = top.name.toLowerCase();
    const b = bottom.name.toLowerCase();
    if (t && (c.includes(t) || t.includes(c))) return "top";
    if (b && (c.includes(b) || b.includes(c))) return "bottom";
    return null;
  };
  return arr(at(game, "game_rounds"))
    .flatMap((r): CSRound[] => {
      const number = int(at(r, "round_number"));
      if (number == null) return [];
      const equipment: Partial<Record<Side, number>> = {};
      for (const clan of arr(at(r, "game_round_team_clans"))) {
        const s = side(str(at(clan, "clan_name")));
        const value = int(at(clan, "equipment_value"));
        if (s && value != null) equipment[s] = value;
      }
      const end = str(at(r, "end_reason"));
      const reason: RoundReason = end === "TargetBombed" ? "bombed" : end === "BombDefused" ? "defused" : end === "TargetSaved" ? "time" : "elimination";
      return [
        {
          number,
          winner: side(str(at(r, "winner_clan_name"))),
          winnerSide: str(at(r, "winner_clan_side")) ?? null,
          reason,
          topEquipment: equipment.top ?? null,
          bottomEquipment: equipment.bottom ?? null,
        },
      ];
    })
    .sort((a, b) => a.number - b.number);
}

/**
 * Parsed rounds of finished maps (they never change), capped, with
 * concurrent loads of the same map sharing one request (CSDetail.RoundCache).
 */
class RoundCache {
  private finished = new Map<number, CSRound[]>();
  private inFlight = new Map<number, Promise<CSRound[] | null>>();
  constructor(private readonly capacity = 64) {}

  async rounds(id: number, isFinished: boolean, load: () => Promise<CSRound[] | null>): Promise<CSRound[] | null> {
    const cached = this.finished.get(id);
    if (cached) return cached;
    const pending = this.inFlight.get(id);
    if (pending) return pending;
    const task = load().catch(() => null);
    this.inFlight.set(id, task);
    const result = await task;
    this.inFlight.delete(id);
    if (isFinished && result) {
      this.finished.set(id, result);
      if (this.finished.size > this.capacity) this.finished.delete(this.finished.keys().next().value!);
    }
    return result;
  }

  clear(): void {
    this.finished.clear();
    this.inFlight.clear();
  }
}

const roundCache = new RoundCache();
/** Tests start from an empty cache. */
export const clearRoundCache = () => roundCache.clear();

// MARK: - Loading

/** A match's page: its detail. */
export async function loadCSDetail(slug: string, event: ScoreEvent, fetcher: Fetcher, options: DetailOptions = {}): Promise<CSDetailPart> {
  return (await loadCSMatch(slug, event, fetcher, options)).part;
}

/**
 * A match's page (CSDetail.load): the match, then in parallel both rosters,
 * every started map's rounds and, while live, the snapshot. Each part fails
 * on its own: a roster or a map that won't load is left out. Also the event
 * as the match record has it, for a page opened off the scoreboards.
 */
export async function loadCSMatch(slug: string, event: ScoreEvent, fetcher: Fetcher, options: DetailOptions = {}): Promise<{ part: CSDetailPart; event: ScoreEvent | null }> {
  const signal = options.signal;
  const raw = await fetcher(matchURL(slug), { signal });
  const match = parseMatch(raw);
  const ids = event.content.kind === "match" ? [teamNumber(event.content.top.id), teamNumber(event.content.bottom.id)] : [null, null];
  const roster = async (team: Team) => (team.slug ? parseRoster(await fetcher(rosterURL(team.slug), { signal })) : EMPTY_ROSTER);
  const started = startedGames(match.games);
  const [top, bottom, live, ...maps] = await Promise.allSettled([
    roster(match.top),
    roster(match.bottom),
    event.state === "live" && match.id != null
      ? fetcher(liveSnapshotURL(match.id), { signal }).then((json) => parseLive(json, match.top.id ?? ids[0] ?? null, match.bottom.id ?? ids[1] ?? null))
      : Promise.resolve(null),
    ...started.map((g) => roundCache.rounds(g.id, g.finished, async () => parseRounds(await fetcher(gameURL(g.id), { signal }), match.top, match.bottom)).then((r) => [g.number, r] as const)),
  ]);
  const rounds: Record<number, readonly CSRound[]> = {};
  for (const m of maps) {
    if (m.status !== "fulfilled") continue;
    const [number, list] = m.value as readonly [number, CSRound[] | null];
    if (list) rounds[number] = list;
  }
  const part: CSDetailPart = {
    roundName: match.roundName,
    tournament: match.tournament,
    maps: match.maps,
    streams: match.streams,
    topRoster: top.status === "fulfilled" ? (top.value as Roster) : EMPTY_ROSTER,
    bottomRoster: bottom.status === "fulfilled" ? (bottom.value as Roster) : EMPTY_ROSTER,
    rounds,
    csLive: live.status === "fulfilled" ? (live.value as CSLive | null) : null,
  };
  return { part, event: makeMatchEvent(raw) };
}

/** The fast lane's reading: bo3.gg's snapshot of the map being played, or null when bo3.gg isn't covering it. */
export async function fetchCSLive(event: ScoreEvent, fetcher: Fetcher, signal?: AbortSignal): Promise<CSLive | null> {
  const id = matchNumber(event.id);
  if (id == null || event.content.kind !== "match") return null;
  try {
    return parseLive(await fetcher(liveSnapshotURL(id), { signal }), teamNumber(event.content.top.id), teamNumber(event.content.bottom.id));
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

// MARK: - Rules (MatchRules)

/** Rounds needed to win the map at this score: 13 in regulation (MR12), then 16, 19, 22… through each six-round overtime. */
export function mapTarget(top: number, bottom: number): number {
  return top + bottom < 24 ? 13 : 16 + 3 * Math.floor((Math.min(top, bottom) - 12) / 3);
}

/** The side one round from taking the map, if either is. */
export function mapPoint(top: number, bottom: number): Side | null {
  const target = mapTarget(top, bottom);
  if (top === target - 1 && bottom < target - 1) return "top";
  if (bottom === target - 1 && top < target - 1) return "bottom";
  return null;
}

/** Maps each side has won once map `number` goes to `winner`, and whether that wins the series (best of `maps.length`). */
export function series(number: number | null, winner: Side, maps: readonly MapResult[]): { wins: number; losses: number; clinched: boolean } | null {
  if (maps.length === 0) return null;
  const others = maps.filter((m) => m.number !== number);
  const wins = others.filter((m) => m.winner === winner).length + 1;
  const losses = others.filter((m) => m.winner != null && m.winner !== winner).length;
  return { wins, losses, clinched: wins >= Math.floor(maps.length / 2) + 1 };
}

/**
 * The state chip for the map being played: MATCH POINT when the side on map
 * point would also take the series with this map, else MAP POINT. (The Mac
 * shows MAP POINT only; MATCH POINT is the web's addition, the same rule
 * one step further.)
 */
export function pointChip(reading: CSLive | null, maps: readonly MapResult[]): { text: "MAP POINT" | "MATCH POINT"; side: Side } | null {
  if (!reading || reading.mapEnded) return null;
  const side = mapPoint(reading.topScore, reading.bottomScore);
  if (!side) return null;
  const clinch = series(reading.mapNumber, side, maps)?.clinched ?? false;
  return { text: clinch ? "MATCH POINT" : "MAP POINT", side };
}

/** Whether one reading is further on than another: the map, then rounds played, then the map's end. */
export function newerReading(a: CSLive, b: CSLive): boolean {
  const key = (r: CSLive) => [r.mapNumber ?? 0, r.topScore + r.bottomScore, r.mapEnded ? 1 : 0] as const;
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < 3; i++) if (ka[i]! !== kb[i]!) return ka[i]! > kb[i]!;
  return false;
}

/**
 * A round won (the score moved), a map won, or the series won, between two
 * live readings of the map being played (MatchRules.csMoments).
 */
export function csMoments(old: CSLive, next: CSLive, names: { top: string; bottom: string }, maps: readonly MapResult[]): LiveMoment[] {
  if (old.mapNumber !== next.mapNumber) return [];
  const score = `${next.topScore}–${next.bottomScore}`;
  // The map's over (the final round may have come in a reading earlier).
  if (next.mapEnded && !old.mapEnded && next.topScore !== next.bottomScore) {
    const side: Side = next.topScore > next.bottomScore ? "top" : "bottom";
    const winner = side === "top" ? names.top : names.bottom;
    const map = next.mapName ?? "the map";
    const id = `cs:${next.mapNumber ?? 0}:end`;
    const s = series(next.mapNumber, side, maps);
    if (s?.clinched) {
      // The map that wins it: decisive (gold, the hero's glint, the trophy).
      const match = maps.length > 1 ? `the series ${s.wins}–${s.losses}` : "the match";
      return [
        liveMoment({ id, chart: "rounds", tier: Tier.score, kind: "mapWon", lead: maps.length > 1 ? "Series won" : "Match won", detail: `${winner} take ${map} ${score} and ${match}`, side, accents: ["decisive"] }),
      ];
    }
    return [liveMoment({ id, chart: "rounds", tier: Tier.score, kind: "mapWon", lead: "Map won", detail: `${winner} take ${map} ${score}`, side })];
  }
  const topWon = next.topScore > old.topScore;
  const bottomWon = next.bottomScore > old.bottomScore;
  if (topWon === bottomWon || next.mapEnded) return [];
  const winner = topWon ? names.top : names.bottom;
  // Rounds played so far, whatever bo3.gg's round counter means mid-round.
  const round = next.topScore + next.bottomScore;
  return [liveMoment({ id: `cs:${next.mapNumber ?? 0}:${round}`, chart: "rounds", tier: Tier.swing, kind: "roundWon", lead: `Round ${round}`, detail: `${winner} won · ${score}`, side: topWon ? "top" : "bottom" })];
}

// MARK: - The round grid (RoundHistoryView)

/** A square in the grid: a round played, one the live score has but the list doesn't yet, or the round being played. */
export type RoundSlot =
  | { readonly kind: "played"; readonly number: number; readonly round: CSRound; readonly winner: Side | null }
  | { readonly kind: "provisional"; readonly number: number; readonly winner: Side }
  | { readonly kind: "next"; readonly number: number; readonly winner: null };

/** MR12: two halves of 12, then overtimes of 6. */
export function chunks<T>(items: readonly T[]): T[][] {
  const blocks: T[][] = [];
  let index = 0;
  while (index < items.length) {
    const size = index < 24 ? 12 : 6;
    blocks.push(items.slice(index, index + size));
    index += size;
  }
  return blocks;
}

/**
 * Rounds bo3.gg's live score counts but its round list doesn't have yet.
 * Their winners are known only when they all went one way (with a split, the
 * order is unknown, and a square would invent it).
 */
export function provisional(rounds: readonly CSRound[], reading: CSLive | null): { number: number; winner: Side }[] {
  if (!reading) return [];
  const top = reading.topScore - rounds.filter((r) => r.winner === "top").length;
  const bottom = reading.bottomScore - rounds.filter((r) => r.winner === "bottom").length;
  if (top < 0 || bottom < 0 || top + bottom === 0 || top + bottom > 6 || (top !== 0 && bottom !== 0)) return [];
  const winner: Side = top > 0 ? "top" : "bottom";
  return Array.from({ length: top + bottom }, (_, i) => ({ number: rounds.length + 1 + i, winner }));
}

/** Blocks of rounds, the provisional ones after them, plus the round being played now while the map is live. */
export function roundSlots(rounds: readonly CSRound[], live: boolean, reading: CSLive | null = null): RoundSlot[][] {
  const all: RoundSlot[] = [
    ...rounds.map((round): RoundSlot => ({ kind: "played", number: round.number, round, winner: round.winner })),
    ...provisional(rounds, reading).map((p): RoundSlot => ({ kind: "provisional", number: p.number, winner: p.winner })),
  ];
  if (live && reading?.mapEnded !== true) all.push({ kind: "next", number: all.length + 1, winner: null });
  return chunks(all);
}

/** The live map from its squares: who's on map point, and a run of 4+ straight rounds. */
export function blockState(slots: readonly RoundSlot[]): { mapPoint: Side | null; streak: { count: number; side: Side } | null } {
  const winners = slots.flatMap((s) => (s.winner ? [s.winner] : []));
  const top = winners.filter((w) => w === "top").length;
  const bottom = winners.length - top;
  let streak: { count: number; side: Side } | null = null;
  const last = winners.at(-1);
  if (last) {
    let count = 0;
    for (let i = winners.length - 1; i >= 0 && winners[i] === last; i--) count++;
    if (count >= 4) streak = { count, side: last };
  }
  return { mapPoint: mapPoint(top, bottom), streak };
}

export function blockTitle(index: number): string {
  return index === 0 ? "1st half" : index === 1 ? "2nd half" : `Overtime ${index - 1}`;
}

export const REASON_LABEL: Readonly<Record<RoundReason, string>> = {
  elimination: "Elimination",
  bombed: "Bomb exploded",
  defused: "Bomb defused",
  time: "Time ran out",
};

/**
 * The moment a block plays, if any: a round won plays in the block holding
 * that round; a map won in the map's last block; a series won in every block.
 * Moment IDs are "cs:<map>:<round>" or "cs:<map>:end".
 */
export function blockCelebration(m: LiveMoment | null, index: number, blocks: readonly (readonly RoundSlot[])[], map: number): LiveMoment | null {
  if (!m) return null;
  const parts = m.id.split(":");
  if (parts.length !== 3 || parts[0] !== "cs" || Number(parts[1]) !== map) return null;
  if (m.kind === "roundWon") {
    const round = Number(parts[2]);
    return blocks[index]?.some((s) => s.number === round) ? m : null;
  }
  if (m.kind === "mapWon") return m.accents.has("decisive") || index === blocks.length - 1 ? m : null;
  return null;
}

/** The hovered round in words, values first: who won and as which side, then the round, how it ended and what each team spent. */
export function roundReadout(round: CSRound, names: { top: string; bottom: string }): { lead: string; detail: string } {
  const winner = round.winner === "top" ? names.top : round.winner === "bottom" ? names.bottom : "Nobody";
  const side = round.winnerSide ? ` as ${round.winnerSide}` : "";
  const money = (amount: number | null, name: string) => (amount == null ? [] : [`${name} $${amount.toLocaleString("en-US")}`]);
  return {
    lead: `${winner} won${side}`,
    detail: [`Round ${round.number}`, REASON_LABEL[round.reason], ...money(round.topEquipment, names.top), ...money(round.bottomEquipment, names.bottom)].join(" · "),
  };
}

/** The maps section's caption (DetailView.mapsCaption). */
export function mapsCaption(maps: readonly MapResult[]): string {
  const bestOf = maps.length;
  if (bestOf <= 1) return "Rounds won on each map.";
  return `Best of ${bestOf}: first to ${Math.floor(bestOf / 2) + 1} maps wins. Rounds won on each map.`;
}

/** The map the round grid opens on: the live map, else the latest played. */
export function defaultMap(rounds: Readonly<Record<number, readonly CSRound[]>>, maps: readonly MapResult[]): number | null {
  const numbers = Object.keys(rounds).map(Number).sort((a, b) => a - b);
  return maps.find((m) => m.live && rounds[m.number] != null)?.number ?? numbers.at(-1) ?? null;
}
