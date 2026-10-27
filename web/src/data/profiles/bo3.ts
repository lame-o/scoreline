/**
 * CS2 team and player pages from bo3.gg, S-tier only (ProfileProviders.swift
 * `BO3Profiles`). bo3.gg addresses players by slug, never by numeric ID; a
 * team link knows the numeric ID (`cs-667`), so its page first looks up the
 * slug.
 */
import { TIER } from "../providers/counterStrike";
import { teamRef, type GameLog, type GameLogEntry, type GameRef, type MapStat, type RosterPlayer, type StatTile, type TeamHeader, type TeamRef, type Title, emptyBio, playerRef, type Bio } from "./models";
import { bo3Photo } from "./photos";
import { arr, at, b, d, i, nonEmpty, parseDate, s, sAt, type JSONValue } from "./read";

const BASE = "https://api.bo3.gg/api/v1";

export const teamURL = (slug: string) => `${BASE}/teams/${slug}?with=players.country`;
export const teamLookupURL = (id: number) => `${BASE}/teams?filter%5Bteams.id%5D%5Beq%5D=${id}`;
export const teamStatsURL = (slug: string) => `${BASE}/teams/${slug}/general_stats`;
export const playerURL = (slug: string) => `${BASE}/players/${slug}`;
export const generalURL = (slug: string) => `${BASE}/players/${slug}/general_stats`;
export const matchesURL = (slug: string) => `${BASE}/players/${slug}/matches_list_stats/general?limit=10`;
export const mapsURL = (slug: string) => `${BASE}/players/${slug}/map_stats`;
export const rolesURL = (slug: string) => `${BASE}/players/${slug}/player_roles`;
export const accuracyURL = (slug: string) => `${BASE}/players/${slug}/accuracy_stats`;

/** The team's next S-tier match (or the one underway). */
export function upcomingURL(teamID: number): string {
  const url = new URL(`${BASE}/matches`);
  url.searchParams.set("filter[matches.team_ids][overlap]", String(teamID));
  url.searchParams.set("filter[matches.status][in]", "upcoming,current");
  url.searchParams.set("filter[matches.tier][in]", TIER);
  url.searchParams.set("sort", "start_date");
  url.searchParams.set("page[limit]", "3");
  url.searchParams.set("with", "teams,tournament");
  return url.href;
}

/** A team's finished S-tier matches (and forfeits), newest first (ResultProvider.swift `CSHistory`). */
export function historyURL(teamID: number, limit = 20): string {
  const url = new URL(`${BASE}/matches`);
  url.searchParams.set("filter[matches.team_ids][overlap]", String(teamID));
  url.searchParams.set("filter[matches.status][in]", "finished,defwin");
  url.searchParams.set("filter[matches.tier][in]", TIER);
  url.searchParams.set("sort", "-start_date");
  url.searchParams.set("page[limit]", String(limit));
  url.searchParams.set("page[offset]", "0");
  url.searchParams.set("with", "teams,tournament");
  return url.href;
}

export function parseSlug(json: JSONValue): string | null {
  return sAt(json, "results", 0, "slug");
}

/** "de_dust2" → "Dust II" (GameDetail.swift `CSDetail.mapName`). */
export function mapName(raw: string | null): string {
  if (!raw) return "TBD";
  const known: Record<string, string> = {
    de_dust2: "Dust II", de_mirage: "Mirage", de_inferno: "Inferno", de_nuke: "Nuke", de_ancient: "Ancient", de_anubis: "Anubis",
    de_vertigo: "Vertigo", de_train: "Train", de_overpass: "Overpass", de_cache: "Cache",
  };
  return known[raw] ?? raw.replaceAll("de_", "").replace(/\S+/g, (w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase());
}

export function ageFrom(birth: number | null, now = Date.now()): number | null {
  if (birth == null) return null;
  const a = new Date(birth);
  const n = new Date(now);
  let years = n.getUTCFullYear() - a.getUTCFullYear();
  if (n.getUTCMonth() < a.getUTCMonth() || (n.getUTCMonth() === a.getUTCMonth() && n.getUTCDate() < a.getUTCDate())) years -= 1;
  return years;
}

export interface CSTeamData {
  readonly header: TeamHeader;
  readonly players: readonly RosterPlayer[];
  readonly titles: readonly Title[];
}

export function parseTeam(json: JSONValue, ref: TeamRef, now = Date.now()): CSTeamData | null {
  const name = sAt(json, "name");
  if (!name) return null;
  const image = sAt(json, "image_url");
  const team: TeamRef = { ...ref, logo: ref.logo ?? image };
  const players = arr(at(json, "players")).flatMap((p): RosterPlayer[] => {
    const slug = sAt(p, "slug");
    const nickname = sAt(p, "nickname");
    const id = i(at(p, "id"));
    if (!slug || !nickname || id == null) return [];
    const status = i(at(p, "status")) ?? 1;
    const real = [sAt(p, "first_name"), sAt(p, "last_name")].filter(Boolean).join(" ");
    const birth = parseDate(sAt(p, "birthday"));
    const rating = d(at(p, "six_month_avg_rating"));
    return [{
      ref: playerRef({ source: { kind: "counterStrike", slug }, id: String(id), name: nickname, photo: bo3Photo(sAt(p, "image_url"), "small"), team, country: sAt(p, "country", "code") }),
      jersey: null,
      position: null,
      positionName: null,
      age: ageFrom(birth, now),
      birthDate: birth,
      height: null,
      weight: null,
      detail: real || null,
      college: null,
      injury: null,
      injuryReturn: null,
      stats: rating != null && rating > 0 ? { RATING: rating.toFixed(2) } : {},
      sourceGroup: null,
      isCoach: b(at(p, "is_coach")) === true,
      benched: status === 2,
    }];
  });
  const slug = sAt(json, "slug");
  const header: TeamHeader = {
    name,
    shortName: name,
    abbreviation: sAt(json, "acronym"),
    logo: image,
    color: null,
    alternateColor: null,
    record: null,
    standing: null,
    coach: players.find((p) => p.isCoach)?.ref.name ?? null,
    venue: null,
    city: null,
    rank: i(at(json, "rank")),
    rankChange: i(at(json, "rank_diff")),
    leagueSlug: null,
    link: slug ? `https://bo3.gg/teams/${slug}` : null,
    next: null,
  };
  // S-tier wins only, as everywhere else in CS2.
  const titles = arr(at(json, "achievements"))
    .filter((a) => sAt(a, "title") === "winner" && sAt(a, "tournament", "tier") === TIER)
    .flatMap((a) => {
      const n = sAt(a, "tournament", "name");
      return n ? [{ name: n, date: parseDate(sAt(a, "date")) }] : [];
    })
    .sort((x, y) => (y.date ?? -Infinity) - (x.date ?? -Infinity));
  return { header, players, titles };
}

/** Team career totals as tiles: matches, maps, events, rounds won. */
export function parseTeamCareer(json: JSONValue): StatTile[] {
  const pct = (won: string, all: string) => {
    const w = d(at(json, won));
    const a = d(at(json, all));
    return w != null && a != null && a > 0 ? `${Math.round((w / a) * 100)}%` : null;
  };
  const tiles: StatTile[] = [];
  const matches = pct("matches_won_count", "matches_count");
  if (matches) tiles.push({ label: "MATCHES", value: matches, rank: "won" });
  const maps = pct("games_won_count", "games_count");
  if (maps) tiles.push({ label: "MAPS", value: maps, rank: "won" });
  const won = i(at(json, "events_won_count"));
  const all = i(at(json, "events_count"));
  if (won != null && all != null) tiles.push({ label: "EVENTS", value: String(won), rank: `won of ${all}` });
  const rounds = pct("rounds_won_count", "rounds_count");
  if (rounds) tiles.push({ label: "ROUNDS", value: rounds, rank: "won" });
  return tiles;
}

/** A bo3 match as a team page's game, from that team's side. */
function matchGame(m: JSONValue, teamID: number): GameRef | null {
  const id = i(at(m, "id"));
  const date = parseDate(sAt(m, "start_date"));
  if (id == null || date == null) return null;
  const usIsOne = i(at(m, "team1", "id")) === teamID || i(at(m, "team1_id")) === teamID;
  const them = usIsOne ? at(m, "team2") : at(m, "team1");
  const themID = i(at(them, "id")) ?? i(at(m, usIsOne ? "team2_id" : "team1_id"));
  const status = sAt(m, "status");
  const final = status === "finished" || status === "defwin";
  const winner = i(at(m, "winner_team_id"));
  const usScore = i(at(m, usIsOne ? "team1_score" : "team2_score"));
  const themScore = i(at(m, usIsOne ? "team2_score" : "team1_score"));
  return {
    id: `cs-${id}`,
    date,
    opponent: themID != null ? teamRef({ id: `cs-${themID}`, name: sAt(them, "name") ?? "TBD", logo: sAt(them, "image_url"), league: "cs2", abbreviation: sAt(them, "acronym") }) : null,
    home: true,
    network: i(at(m, "bo_type")) != null ? `Best of ${i(at(m, "bo_type"))}` : null,
    state: status === "current" ? "live" : final ? "final" : "scheduled",
    // A forfeit's score is a placeholder: say the result, not a fake score.
    teamScore: final && status !== "defwin" && usScore != null ? String(usScore) : null,
    opponentScore: final && status !== "defwin" && themScore != null ? String(themScore) : null,
    result: final ? (winner === teamID ? "W" : winner != null ? "L" : "D") : null,
    competition: sAt(m, "tournament", "name"),
    slug: sAt(m, "slug"),
  };
}

export function parseNextMatch(json: JSONValue, teamID: number): GameRef | null {
  const m = arr(at(json, "results"))[0];
  return m ? matchGame(m, teamID) : null;
}

/** A team's recent S-tier results, newest first. */
export function parseHistory(json: JSONValue, teamID: number): GameRef[] {
  return arr(at(json, "results"))
    .flatMap((m) => matchGame(m, teamID) ?? [])
    .filter((g) => g.state === "final")
    .sort((x, y) => y.date - x.date);
}

export interface CSPlayerData {
  readonly bio: Bio;
  readonly rating: number | null;
}

export function parsePlayer(json: JSONValue, now = Date.now()): CSPlayerData | null {
  const nickname = sAt(json, "nickname");
  if (!nickname) return null;
  const t = at(json, "team");
  const birth = parseDate(sAt(json, "birthday"));
  const teamID = i(at(t, "id"));
  const slug = sAt(json, "slug");
  const bio: Bio = {
    ...emptyBio(nickname),
    realName: nonEmpty([sAt(json, "first_name"), sAt(json, "last_name")].filter(Boolean).join(" ")),
    photo: bo3Photo(sAt(json, "image_url"), "hero"),
    birthDate: birth,
    age: ageFrom(birth, now),
    nationality: sAt(json, "country", "name"),
    country: sAt(json, "country", "code"),
    since: parseDate(sAt(json, "joined_team_at")),
    prizeMoney: d(at(json, "total_prize")),
    position: b(at(json, "is_coach")) === true ? "Coach" : null,
    team: teamID != null ? teamRef({ id: `cs-${teamID}`, name: sAt(t, "name") ?? "", logo: sAt(t, "image_url"), league: "cs2", abbreviation: sAt(t, "acronym") }) : null,
    link: slug ? `https://bo3.gg/players/${slug}` : null,
  };
  return { bio, rating: d(at(json, "six_month_avg_rating")) };
}

/** Career K/D and ADR (bo3 ignores date filters, so these are career figures). */
export function parseGeneral(json: JSONValue): { kd: number | null; adr: number | null } {
  const kills = d(at(json, "kills_sum"));
  const deaths = d(at(json, "deaths_sum"));
  const damage = d(at(json, "damage_sum"));
  const rounds = d(at(json, "rounds_count"));
  return {
    kd: kills != null && deaths != null && deaths > 0 ? kills / deaths : null,
    adr: damage != null && rounds != null && rounds > 0 ? damage / rounds : null,
  };
}

/** Headshot share of kills, from hit groups. */
export function parseHeadshotShare(json: JSONValue): number | null {
  const groups = arr(json);
  const kills = groups.reduce<number>((sum, g) => sum + (d(at(g, "kills_sum")) ?? 0), 0);
  const head = d(at(groups.find((g) => sAt(g, "hit_group") === "Head"), "kills_sum"));
  return kills > 0 && head != null ? head / kills : null;
}

/** The last matches as a game log: rating, kills–deaths, ADR, HS%. */
export function parseMatches(json: JSONValue): GameLog | null {
  const entries = arr(json)
    .flatMap((m): GameLogEntry[] => {
      const id = i(at(m, "match_id"));
      const date = parseDate(sAt(m, "match_start_date"));
      if (id == null || date == null) return [];
      const st = at(m, "stats", 0);
      const wins = arr(at(m, "game_wins")).flatMap((w) => i(w) ?? []);
      const won = wins.filter((w) => w === 1).length;
      const lost = wins.filter((w) => w === 0).length;
      // Maps arrive in `game_numbers` order, which isn't sorted.
      const numbers = arr(at(m, "game_numbers")).flatMap((n) => i(n) ?? []);
      const maps = arr(at(m, "for_game_map_name")).flatMap((n) => s(n) ?? []);
      const ordered = numbers
        .slice(0, maps.length)
        .map((n, k) => [n, maps[k]!] as const)
        .sort((x, y) => x[0] - y[0])
        .map(([, name]) => mapName(name));
      const stats: Record<string, string> = {};
      const rating = d(at(st, "player_rating"));
      if (rating != null) stats.rating = rating.toFixed(2);
      const kills = i(at(st, "kills"));
      const deaths = i(at(st, "death"));
      if (kills != null && deaths != null) {
        stats.kd = `${kills}–${deaths}`;
        stats.kills = String(kills);
      }
      const damage = d(at(st, "damage"));
      const rounds = d(at(m, "rounds_count"));
      if (damage != null && rounds != null && rounds > 0) stats.adr = (damage / rounds).toFixed(0);
      const hs = d(at(st, "headshots"));
      if (hs != null && kills != null && kills > 0) stats.hs = `${Math.round((hs / kills) * 100)}%`;
      stats.maps = ordered.join(", ");
      const enemy = i(at(m, "enemy_team_id"));
      return [{
        // The web's game pages address bo3 matches as the scoreboard does (`cs-<id>`); the Mac's use the slug.
        eventID: `cs-${id}`,
        date,
        opponent: enemy != null ? teamRef({ id: `cs-${enemy}`, name: sAt(m, "enemy_team_name") ?? "", logo: sAt(m, "enemy_team_image_url"), league: "cs2" }) : null,
        home: true,
        result: won > lost ? "W" : won < lost ? "L" : "D",
        teamScore: String(won),
        opponentScore: String(lost),
        stats,
        postseason: false,
        competition: sAt(m, "tournament_slug"),
        played: true,
      }];
    })
    .sort((x, y) => x.date - y.date);
  if (entries.length === 0) return null;
  return {
    columns: [{ key: "maps", label: "MAPS" }, { key: "rating", label: "RATING" }, { key: "kd", label: "K–D" }, { key: "adr", label: "ADR" }, { key: "hs", label: "HS%" }],
    entries,
    stripKey: "rating",
    stripLabel: "Rating",
    markKey: null,
    reference: null,
    referenceLabel: null,
    matchStrip: false,
    season: null,
    category: null,
  };
}

export function parseMaps(json: JSONValue): MapStat[] {
  return arr(json)
    .flatMap((m): MapStat[] => {
      const raw = sAt(m, "map_name");
      const count = i(at(m, "maps_count"));
      const rating = d(at(m, "avg_player_rating"));
      if (!raw || count == null || count <= 0 || rating == null) return [];
      return [{ name: mapName(raw), maps: count, rating, adr: d(at(m, "avg_damage")) ?? 0 }];
    })
    .sort((x, y) => y.rating - x.rating);
}

const ROLE_NAMES: Readonly<Record<string, string>> = {
  awper: "AWPer", anchor: "Anchor", rotator: "Rotator", play_maker: "Playmaker", entry_fragger: "Entry", lurker: "Lurker", trader: "Trader", support: "Support",
};

/** The two roles a player fills most: "AWPer", "Anchor". */
export function parseRoles(json: JSONValue): string[] {
  const totals = new Map<string, number>();
  for (const r of arr(json)) {
    const role = sAt(r, "role");
    const count = i(at(r, "count"));
    if (!role || count == null || count <= 0) continue;
    totals.set(role, (totals.get(role) ?? 0) + count);
  }
  return [...totals.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([role]) => ROLE_NAMES[role] ?? role.replace(/\S+/g, (w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase()));
}

/** The CS2 form tiles: bo3's rating, and career K/D, ADR and headshots. */
export function csTiles(rating: number | null, kd: number | null, adr: number | null, hs: number | null): StatTile[] {
  const tiles: StatTile[] = [];
  if (rating != null && rating > 0) tiles.push({ label: "RATING", value: rating.toFixed(2), rank: "6 months" });
  if (kd != null) tiles.push({ label: "K/D", value: kd.toFixed(2), rank: "Career" });
  if (adr != null) tiles.push({ label: "ADR", value: adr.toFixed(1), rank: "Career" });
  if (hs != null) tiles.push({ label: "HS%", value: `${Math.round(hs * 100)}%`, rank: "Career" });
  return tiles;
}

