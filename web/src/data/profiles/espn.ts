/**
 * ESPN team and player pages: URL builders and pure parsers, a port of
 * ProfileProviders.swift `ESPNProfiles` (and `ProfileStore`'s college and
 * league-rank fills). Parsing is lenient: a reshaped field drops that detail,
 * never the page. The Swift comments that explain a decision sit beside the
 * line they explain.
 */
import { espnTeamID } from "../teams";
import type { Sport } from "../models";
import {
  emptyBio,
  profileRank,
  sportOfPath,
  teamRef,
  type Bio,
  type DepthChart,
  type DepthSlot,
  type DepthUnit,
  type DepthUnitKind,
  type GameLog,
  type GameLogColumn,
  type GameLogEntry,
  type GameRef,
  type InjuryNote,
  type Leaders,
  type Note,
  type PlayerRef,
  type RosterGroup,
  type RosterGroupKind,
  type RosterPlayer,
  type StatTable,
  type StatTile,
  type TeamHeader,
  type TeamLeader,
  type TeamRef,
  type TeamStat,
  type Transaction,
  DEPTH_UNIT_ORDER,
  playerRef,
} from "./models";
import { espnPhoto } from "./photos";
import { arr, at, b, capitalizedFirst, entries, exists, i, label, nonEmpty, parseDate, refID, rotowireDate, s, sAt, type JSONValue } from "./read";

export const SITE = "https://site.api.espn.com/apis/site/v2/sports";
export const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
export const CORE = "https://sports.core.api.espn.com/v2/sports";

/** "basketball/nba" → "…/basketball/leagues/nba". */
export function corePrefix(path: string): string {
  const parts = path.split("/");
  return parts.length === 2 ? `${CORE}/${parts[0]}/leagues/${parts[1]}` : `${CORE}/${path}`;
}

/**
 * The season year and type core URLs need, from the calendar (no waterfall).
 * NBA seasons are named by their ending year; soccer by the starting one.
 */
export function espnSeason(path: string, now: number = Date.now()): { year: number; type: number } {
  const date = new Date(now);
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (path.startsWith("basketball")) return { year: m >= 8 ? y + 1 : y, type: 2 };
  if (path.startsWith("soccer")) return { year: m >= 7 ? y : y - 1, type: 1 };
  return { year: m <= 2 ? y - 1 : y, type: 2 };
}

// MARK: - URLs

export const teamURL = (path: string | null, team: string) => `${SITE}/${path ?? "soccer/all"}/teams/${team}`;
export const rosterURL = (path: string, team: string) => `${SITE}/${path}/teams/${team}/roster`;

/** NFL's site chart has names inline; NBA and MLB have core charts; college has none (400). */
export function depthURL(path: string, team: string, now = Date.now()): string | null {
  switch (path) {
    case "football/nfl":
      return `${SITE}/${path}/teams/${team}/depthcharts`;
    case "basketball/nba":
    case "baseball/mlb":
      return `${corePrefix(path)}/seasons/${espnSeason(path, now).year}/teams/${team}/depthcharts`;
    default:
      return null;
  }
}

export function leadersURL(path: string, team: string, now = Date.now()): string {
  const season = espnSeason(path, now);
  return `${corePrefix(path)}/seasons/${season.year}/types/${season.type}/teams/${team}/leaders`;
}

const RANKED = ["basketball/nba", "football/nfl", "baseball/mlb"];

/** Team stats with league ranks: not soccer (no ranks) or college (ranks among 260 teams). */
export function teamStatsURL(path: string, team: string, now = Date.now()): string | null {
  if (!RANKED.includes(path)) return null;
  const season = espnSeason(path, now);
  return `${corePrefix(path)}/seasons/${season.year}/types/${season.type}/teams/${team}/statistics`;
}

export function transactionsURL(path: string, team: string): string | null {
  return RANKED.includes(path) ? `${SITE}/${path}/transactions?team=${team}&limit=20` : null;
}

export const athleteURL = (path: string, id: string) => `${WEB}/${path}/athletes/${id}`;
export const overviewURL = (path: string, id: string) => `${WEB}/${path}/athletes/${id}/overview`;
export const careerURL = (path: string, id: string) => `${WEB}/${path}/athletes/${id}/stats`;
export const coreAthleteURL = (path: string, id: string) => `${corePrefix(path)}/athletes/${id}`;
export const gamelogURL = (path: string, id: string, category?: string | null) =>
  `${WEB}/${path}/athletes/${id}/gamelog${category ? `?category=${category}` : ""}`;

/** League top 25 per category: the rank source where ESPN's summary has none (NBA, soccer). */
export function leagueLeadersURL(path: string, now = Date.now()): string {
  const season = espnSeason(path, now);
  return `${corePrefix(path)}/seasons/${season.year}/types/${season.type}/leaders?limit=25`;
}

/** The league slug for a player's ESPN path ("basketball/nba" → "nba"). */
export function leagueForPath(path: string): string | null {
  switch (path) {
    case "basketball/nba":
      return "nba";
    case "football/nfl":
      return "nfl";
    case "football/college-football":
      return "college-football";
    case "baseball/mlb":
      return "mlb";
    default:
      return path.startsWith("soccer/") ? path.slice(7) : null;
  }
}

/** The first link with a `rel`. */
function linkWith(value: JSONValue, rel: string): string | null {
  const link = arr(value).find((l) => arr(at(l, "rel")).some((r) => r === rel));
  return link ? sAt(link, "href") : null;
}

// MARK: - Team

export function parseHeader(json: JSONValue, sport: Sport, path: string | null, teamID: string): TeamHeader | null {
  const t = at(json, "team");
  const name = sAt(t, "displayName");
  if (!name) return null;
  const venue = exists(at(t, "franchise", "venue")) ? at(t, "franchise", "venue") : at(t, "venue");
  const leagueSlug = sAt(t, "leagueAbbrev");
  const event = at(t, "nextEvent", 0);
  const record = arr(at(t, "record", "items")).find((item) => sAt(item, "type") === "total");
  const standingText = sAt(t, "standingSummary");
  return {
    name,
    shortName: sAt(t, "shortDisplayName") ?? name,
    abbreviation: sAt(t, "abbreviation"),
    logo: sAt(t, "logos", 0, "href") ?? sAt(t, "logo"),
    color: sAt(t, "color"),
    alternateColor: sAt(t, "alternateColor"),
    record: record ? sAt(record, "summary") : null,
    // ESPN's standing is wrong in the MLB postseason ("5th in NL West" for a 100-62 division winner).
    standing: standingText && !(sport === "baseball" && i(at(event, "seasonType", "type")) === 3) ? cleanStanding(standingText) : null,
    coach: null,
    venue: sAt(venue, "fullName"),
    city: sAt(venue, "address", "city"),
    rank: null,
    rankChange: null,
    leagueSlug,
    link: linkWith(at(t, "links"), "clubhouse"),
    next: parseGame(event, sport, path ?? `soccer/${leagueSlug ?? "all"}`, teamID),
  };
}

/** "2nd in English Premier League" → "2nd in Premier League". */
export function cleanStanding(text: string): string {
  let t = text;
  for (const nation of ["English ", "Spanish ", "German ", "Italian ", "French "]) t = t.replaceAll(`in ${nation}`, "in ");
  // ESPN files some NBA teams under their conference as if it were a division.
  return t.replaceAll("in LALIGA", "in LaLiga").replaceAll(" Conference Division", " Conference");
}

/** A scoreboard-shaped event, from the team's side. */
export function parseGame(e: JSONValue, sport: Sport, path: string, teamID: string): GameRef | null {
  const c = at(e, "competitions", 0);
  const id = sAt(e, "id");
  const date = parseDate(sAt(e, "date"));
  if (!id || date == null) return null;
  const comps = arr(at(c, "competitors"));
  const us = comps.find((x) => sAt(x, "team", "id") === teamID) ?? comps[0];
  const usID = sAt(us, "team", "id");
  const them = comps.find((x) => sAt(x, "team", "id") !== usID);
  if (us == null || them == null) return null;
  const score = (j: JSONValue) => sAt(j, "score", "displayValue") ?? sAt(j, "score");
  const raw = sAt(c, "status", "type", "state") ?? sAt(e, "status", "type", "state");
  const state = raw === "in" ? "live" : raw === "post" ? "final" : "scheduled";
  const ot = at(them, "team");
  const otID = sAt(ot, "id");
  const opponent = otID
    ? teamRef({
        id: espnTeamID(path, sport, otID),
        name: sAt(ot, "shortDisplayName") ?? sAt(ot, "displayName") ?? sAt(ot, "abbreviation") ?? "",
        logo: sAt(ot, "logos", 0, "href") ?? sAt(ot, "logo"),
        color: sAt(ot, "color"),
        abbreviation: sAt(ot, "abbreviation"),
        league: leagueForPath(path),
      })
    : null;
  const network = arr(at(c, "broadcasts")).map((x) => sAt(x, "media", "shortName") ?? sAt(x, "names", 0)).find((n) => n != null) ?? null;
  const won = b(at(us, "winner"));
  return {
    id,
    date,
    opponent,
    home: sAt(us, "homeAway") === "home",
    network,
    state,
    teamScore: state === "scheduled" ? null : score(us),
    opponentScore: state === "scheduled" ? null : score(them),
    result: state === "final" ? (won === true ? "W" : b(at(them, "winner")) === true ? "L" : "D") : null,
    competition: sAt(e, "league", "abbreviation"),
    slug: null,
  };
}

export interface RosterData {
  readonly players: readonly RosterPlayer[];
  readonly coach: string | null;
  readonly seasonYear: number | null;
}

export function parseRoster(json: JSONValue, sport: Sport, path: string, team: TeamRef): RosterData {
  const players: RosterPlayer[] = [];
  const add = (a: JSONValue, group: string | null) => {
    const id = sAt(a, "id");
    const name = sAt(a, "displayName") ?? sAt(a, "fullName");
    if (!id || !name) return;
    const position = sAt(a, "position", "abbreviation");
    const hasHeadshot = sAt(a, "headshot", "href") != null;
    // Soccer headshots are rare (≈5%): only ask for the ones ESPN lists.
    const photo = sport === "soccer" && !hasHeadshot ? null : espnPhoto(path, id, "small");
    const jersey = sAt(a, "jersey");
    let detail: string | null = null;
    let college = sAt(a, "college", "name");
    const stats: Record<string, string> = {};
    if (sport === "football" && path.endsWith("college-football")) {
      detail = sAt(a, "experience", "displayValue");
      college = null;
    } else if (sport === "soccer") {
      detail = sAt(a, "citizenship");
      for (const category of arr(at(a, "statistics", "splits", "categories"))) {
        for (const stat of arr(at(category, "stats"))) {
          const key = sAt(stat, "name");
          const value = sAt(stat, "displayValue");
          if (key && value != null) stats[key] = value;
        }
      }
    }
    players.push({
      ref: playerRef({ source: { kind: "espn", path }, id, name, photo, team, jersey, position }),
      jersey,
      position,
      positionName: sAt(a, "position", "displayName"),
      age: i(at(a, "age")),
      birthDate: parseDate(sAt(a, "dateOfBirth")),
      height: sAt(a, "displayHeight"),
      weight: sAt(a, "displayWeight"),
      detail,
      college,
      injury: sAt(a, "injuries", 0, "status"),
      injuryReturn: null,
      stats,
      sourceGroup: group,
      isCoach: false,
      benched: false,
    });
  };
  for (const entry of arr(at(json, "athletes"))) {
    if (exists(at(entry, "items"))) for (const a of arr(at(entry, "items"))) add(a, sAt(entry, "position"));
    else add(entry, null);
  }
  // ESPN's soccer "coach" is a list of past managers: never shown.
  const c = at(json, "coach", 0);
  const coach = sport === "soccer" ? null : nonEmpty([sAt(c, "firstName"), sAt(c, "lastName")].filter(Boolean).join(" "));
  return { players, coach, seasonYear: i(at(json, "season", "year")) };
}

/** Slot order within each unit (JSON objects arrive unordered). */
export const SLOT_ORDER: Readonly<Record<DepthUnitKind, readonly string[]>> = {
  offense: ["qb", "rb", "fb", "wr1", "wr2", "wr3", "wr", "te", "lt", "lg", "c", "rg", "rt"],
  defense: ["lde", "ldt", "nt", "rdt", "rde", "wlb", "lilb", "mlb", "rilb", "slb", "lolb", "rolb", "lcb", "ss", "fs", "rcb", "nb"],
  specialTeams: ["pk", "p", "h", "ls", "kr", "pr"],
};

/** NFL's site chart: offense, defense, special teams, slots in depth order. */
export function parseDepthChart(json: JSONValue): DepthChart | null {
  const units = arr(at(json, "depthchart")).flatMap((u): DepthUnit[] => {
    const positions = entries(at(u, "positions"));
    if (positions.length === 0 && !exists(at(u, "positions"))) return [];
    const name = sAt(u, "name") ?? "";
    const keys = positions.map(([k]) => k);
    const kind: DepthUnitKind = name.toLowerCase().includes("special") ? "specialTeams" : keys.includes("qb") ? "offense" : "defense";
    const order = SLOT_ORDER[kind];
    const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : Number.MAX_SAFE_INTEGER);
    const sorted = [...positions].sort(([a], [b2]) => rank(a) - rank(b2) || (a < b2 ? -1 : a > b2 ? 1 : 0));
    const slots = sorted.flatMap(([key, p]): DepthSlot[] => {
      const players = arr(at(p, "athletes")).flatMap((a) => {
        const id = sAt(a, "id");
        const n = sAt(a, "displayName") ?? sAt(a, "shortName");
        return id && n ? [{ id, name: n }] : [];
      });
      return players.length > 0 ? [{ key, label: sAt(p, "position", "abbreviation") ?? key.toUpperCase(), players }] : [];
    });
    return [{ kind, name, slots }];
  });
  if (units.length === 0) return null;
  return { units: [...units].sort((a, b2) => DEPTH_UNIT_ORDER[a.kind] - DEPTH_UNIT_ORDER[b2.kind]) };
}

/** NBA/MLB core charts: slot key → athlete IDs in depth order. */
export function parseCoreDepth(json: JSONValue): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of entries(at(json, "items", 0, "positions"))) {
    out[key] = arr(at(value, "athletes")).flatMap((a) => refID(sAt(a, "athlete", "$ref")) ?? []);
  }
  return out;
}

/** Core team (or league) leaders: category → (athlete ID, display value), ranked. */
export function parseLeaders(json: JSONValue): Leaders {
  const out: Record<string, { id: string; value: string }[]> = {};
  for (const c of arr(at(json, "categories"))) {
    const name = sAt(c, "name");
    if (!name) continue;
    out[name] = arr(at(c, "leaders")).flatMap((l) => {
      const id = refID(sAt(l, "athlete", "$ref"));
      const value = sAt(l, "displayValue");
      return id && value != null ? [{ id, value }] : [];
    });
  }
  return out;
}

const TEAM_STAT_PICKS: Partial<Record<Sport, { picks: readonly [string, string][]; field: number }>> = {
  basketball: {
    picks: [["offensive.fieldGoalPct", "Field goal %"], ["offensive.threePointPct", "3-point %"], ["offensive.trueShootingPct", "True shooting %"],
      ["offensive.assists", "Assists"], ["general.reboundRate", "Rebound rate"], ["defensive.steals", "Steals"], ["defensive.blocks", "Blocks"],
      ["offensive.turnovers", "Turnovers"]],
    field: 30,
  },
  football: {
    picks: [["passing.totalPointsPerGame", "Points per game"], ["passing.yardsPerGame", "Yards per game"],
      ["passing.passingYardsPerGame", "Passing yards per game"], ["rushing.rushingYardsPerGame", "Rushing yards per game"],
      ["miscellaneous.thirdDownConvPct", "Third-down %"], ["miscellaneous.totalTakeaways", "Takeaways"], ["defensive.sacks", "Sacks"],
      ["miscellaneous.turnOverDifferential", "Turnover margin"]],
    field: 32,
  },
  baseball: {
    picks: [["batting.runs", "Runs scored"], ["batting.avg", "Batting average"], ["batting.OPS", "OPS"], ["batting.homeRuns", "Home runs"],
      ["pitching.ERA", "ERA"], ["pitching.WHIP", "WHIP"], ["pitching.strikeouts", "Strikeouts"], ["pitching.runs", "Runs allowed"]],
    field: 30,
  },
};

/** The league's size for a sport's rank tracks. */
export function rankField(sport: Sport | null): number {
  return sport === "football" ? 32 : 30;
}

/**
 * Team stats with league ranks, chosen for meaning (ranks past the league's
 * size are ESPN noise and dropped).
 */
export function parseTeamStats(json: JSONValue, sport: Sport): TeamStat[] {
  const all = new Map<string, { value: string; rank: string | null }>();
  for (const c of arr(at(json, "splits", "categories"))) {
    const category = sAt(c, "name") ?? "";
    for (const stat of arr(at(c, "stats"))) {
      const name = sAt(stat, "name");
      const value = sAt(stat, "displayValue");
      if (name && value != null) all.set(`${category}.${name}`, { value, rank: sAt(stat, "rankDisplayValue") });
    }
  }
  const spec = TEAM_STAT_PICKS[sport];
  if (!spec) return [];
  return spec.picks.flatMap(([key, lbl]) => {
    const entry = all.get(key);
    if (!entry) return [];
    const rank = profileRank(entry.rank, spec.field);
    return [{ key, label: lbl, value: entry.value, rank: rank?.rank ?? null, rankText: rank?.text ?? null }];
  });
}

export function parseTransactions(json: JSONValue): Transaction[] {
  return arr(at(json, "transactions")).flatMap((t) => {
    let text = sAt(t, "description");
    if (!text) return [];
    // ESPN clips some at a fixed length ("…to a contrac."); finish the one word that's always clipped.
    if (text.endsWith(" contrac.")) text = `${text.slice(0, -9)} contract.`;
    return [{ date: parseDate(sAt(t, "date")), text }];
  });
}

// MARK: - Roster assembly

/** Which leader categories fill which roster columns. */
export const LEADER_COLUMNS: Partial<Record<Sport, Readonly<Record<string, string>>>> = {
  basketball: { PTS: "pointsPerGame", REB: "reboundsPerGame", AST: "assistsPerGame", MIN: "minutesPerGame", "FG%": "fieldGoalPercentage" },
  football: {
    PYDS: "passingYards", PTD: "passingTouchdowns", RYDS: "rushingYards", RTD: "rushingTouchdowns", REC: "receptions",
    RECYDS: "receivingYards", RECTD: "receivingTouchdowns", TOT: "totalTackles", SACK: "sacks", INT: "interceptions",
  },
  baseball: { AVG: "avg", HR: "homeRuns", RBI: "RBIs", OPS: "OPS", ERA: "ERA", K: "strikeouts", W: "wins", SV: "saves", WHIP: "WHIP" },
};

const FOOTBALL_ORDER = ["QB", "RB", "FB", "WR", "TE", "OT", "OL", "G", "C", "DE", "DL", "DT", "NT", "LB", "OLB", "ILB", "CB", "DB", "S", "PK", "K", "P", "LS"];

/** Lexicographic tuple comparison, ascending. */
function compareTuples(a: readonly number[], b2: readonly number[]): number {
  for (let k = 0; k < Math.min(a.length, b2.length); k++) if (a[k] !== b2[k]) return a[k]! - b2[k]!;
  return 0;
}

/** Groups the roster the way each sport thinks of it, filling stat columns from the leaders. */
export function groupRoster(sport: Sport, source: readonly RosterPlayer[], leaders: Leaders, depth: Readonly<Record<string, readonly string[]>>): RosterGroup[] {
  let players = source;
  const columns = LEADER_COLUMNS[sport];
  if (columns) {
    const lookup = new Map<string, Record<string, string>>();
    for (const [column, category] of Object.entries(columns)) {
      for (const entry of leaders[category] ?? []) {
        const row = lookup.get(entry.id) ?? {};
        row[column] = entry.value;
        lookup.set(entry.id, row);
      }
    }
    // The player's own values win (Swift's merge keeps the existing one).
    players = players.map((p) => (lookup.has(p.ref.id) ? { ...p, stats: { ...lookup.get(p.ref.id), ...p.stats } } : p));
  }
  const number = (p: RosterPlayer) => {
    const n = Number(p.jersey ?? "");
    return p.jersey && Number.isInteger(n) ? n : 999;
  };
  const group = (kind: RosterGroupKind, list: readonly RosterPlayer[]): RosterGroup => ({ kind, players: list });
  const nonEmptyGroups = (groups: RosterGroup[]) => groups.filter((g) => g.players.length > 0);
  switch (sport) {
    case "basketball": {
      const out = players.filter((p) => p.injury === "Out");
      const outIDs = new Set(out.map((p) => p.ref.id));
      const used = new Set<string>();
      const starters: RosterPlayer[] = [];
      for (const slot of ["pg", "sg", "sf", "pf", "c"]) {
        const id = (depth[slot] ?? []).find((x) => !used.has(x) && !outIDs.has(x));
        const p = id ? players.find((x) => x.ref.id === id) : undefined;
        if (id && p) {
          used.add(id);
          starters.push(p);
        }
      }
      const minutes = (p: RosterPlayer) => {
        const v = Number(p.stats.MIN ?? "");
        return p.stats.MIN && Number.isFinite(v) ? v : -1;
      };
      const bench = players
        .filter((p) => !used.has(p.ref.id) && p.injury !== "Out")
        .sort((a, b2) => compareTuples([minutes(b2), -number(b2)], [minutes(a), -number(a)]));
      return nonEmptyGroups([group("starters", starters), group("bench", bench), group("out", out)]);
    }
    case "football": {
      // Within a position: depth-chart rank (starters first), then jersey.
      const rank = new Map<string, number>();
      for (const ids of Object.values(depth)) ids.forEach((id, k) => rank.set(id, Math.min(rank.get(id) ?? k, k)));
      const pos = (p: RosterPlayer) => {
        const k = FOOTBALL_ORDER.indexOf(p.position ?? "");
        return k < 0 ? 99 : k;
      };
      const sorted = (list: readonly RosterPlayer[]) =>
        [...list].sort((a, b2) => compareTuples([pos(a), rank.get(a.ref.id) ?? 50, number(a)], [pos(b2), rank.get(b2.ref.id) ?? 50, number(b2)]));
      const map: [string, RosterGroupKind][] = [["offense", "offense"], ["defense", "defense"], ["specialTeam", "specialTeams"],
        ["injuredReserveOrOut", "injuredReserve"], ["practiceSquad", "practiceSquad"]];
      return nonEmptyGroups(map.map(([name, kind]) => group(kind, sorted(players.filter((p) => p.sourceGroup === name)))));
    }
    case "baseball": {
      const rotationIDs = depth.p ?? [];
      const closer = depth.cl ?? [];
      const pitchers = players.filter((p) => p.sourceGroup === "Pitchers" || ["SP", "RP", "P"].includes(p.position ?? ""));
      const rotationRank = (p: RosterPlayer) => (rotationIDs.includes(p.ref.id) ? rotationIDs.indexOf(p.ref.id) : 99);
      const rotation = pitchers.filter((p) => p.position === "SP").sort((a, b2) => rotationRank(a) - rotationRank(b2));
      const closes = (p: RosterPlayer) => (closer.includes(p.ref.id) ? 0 : 1);
      const bullpen = pitchers.filter((p) => p.position !== "SP").sort((a, b2) => compareTuples([closes(a), number(a)], [closes(b2), number(b2)]));
      const pitcherIDs = new Set(pitchers.map((p) => p.ref.id));
      const rest = players.filter((p) => !pitcherIDs.has(p.ref.id));
      const byGroup = (name: string, kind: RosterGroupKind) => group(kind, rest.filter((p) => p.sourceGroup === name).sort((a, b2) => number(a) - number(b2)));
      return nonEmptyGroups([group("rotation", rotation), group("bullpen", bullpen), byGroup("Catchers", "catchers"), byGroup("Infielders", "infielders"),
        byGroup("Outfielders", "outfielders"), byGroup("Designated Hitter", "designatedHitters")]);
    }
    case "soccer": {
      const apps = (p: RosterPlayer) => {
        const v = Number(p.stats.appearances ?? "");
        return p.stats.appearances && Number.isInteger(v) ? v : -1;
      };
      const kinds: [string, RosterGroupKind][] = [["G", "goalkeepers"], ["D", "defenders"], ["M", "midfielders"], ["F", "forwards"]];
      return nonEmptyGroups(
        kinds.map(([code, kind]) =>
          group(kind, players.filter((p) => p.position === code).sort((a, b2) => compareTuples([apps(b2), -number(b2)], [apps(a), -number(a)]))),
        ),
      );
    }
    default:
      return [group("players", players)];
  }
}

const LEADER_PICKS: Partial<Record<Sport, readonly [string, string][]>> = {
  basketball: [["pointsPerGame", "PTS"], ["reboundsPerGame", "REB"], ["assistsPerGame", "AST"], ["blocksPerGame", "BLK"]],
  football: [["passingYards", "PASS YDS"], ["rushingYards", "RUSH YDS"], ["receivingYards", "REC YDS"], ["totalTackles", "TACKLES"]],
  baseball: [["avg", "AVG"], ["homeRuns", "HR"], ["ERA", "ERA"], ["strikeouts", "K"]],
  soccer: [["goals", "GOALS"], ["assists", "ASSISTS"]],
};

/** The team's leaders by category, named from the roster. */
export function teamLeaders(sport: Sport, leaders: Leaders, roster: readonly RosterPlayer[]): TeamLeader[] {
  const byID = new Map<string, RosterPlayer>();
  for (const p of roster) if (!byID.has(p.ref.id)) byID.set(p.ref.id, p);
  return (LEADER_PICKS[sport] ?? []).flatMap(([category, lbl]) => {
    const top = leaders[category]?.[0];
    const player = top ? byID.get(top.id) : undefined;
    return top && player ? [{ category, label: lbl, value: top.value, player: player.ref }] : [];
  });
}

// MARK: - Player

export interface AthleteData {
  readonly bio: Bio;
  readonly tiles: readonly StatTile[];
  readonly tilesCaption: string | null;
  readonly injury: InjuryNote | null;
}

/** The v3 athlete: bio display strings, the team, injuries and the ranked season summary. */
export function parseAthlete(json: JSONValue, path: string): AthleteData | null {
  const a = at(json, "athlete");
  const name = sAt(a, "displayName");
  const id = sAt(a, "id");
  if (!name || !id) return null;
  const t = at(a, "team");
  const sport = sportOfPath(path);
  const tid = sAt(t, "id");
  const team = tid
    ? teamRef({
        id: espnTeamID(path, sport, tid),
        name: sAt(t, "shortDisplayName") ?? sAt(t, "displayName") ?? "",
        logo: sAt(t, "logos", 0, "href"),
        league: leagueForPath(path),
        color: sAt(t, "color"),
        alternateColor: sAt(t, "alternateColor"),
        abbreviation: sAt(t, "abbreviation"),
      })
    : null;
  const bio: Bio = {
    ...emptyBio(name),
    jersey: sAt(a, "jersey"),
    position: sAt(a, "position", "displayName"),
    positionAbbreviation: sAt(a, "position", "abbreviation"),
    team,
    photo: sAt(a, "headshot", "href") != null || sport !== "soccer" ? espnPhoto(path, id, "hero") : null,
    active: b(at(a, "active")) ?? true,
    age: i(at(a, "age")),
    birthPlace: sAt(a, "displayBirthPlace"),
    height: sAt(a, "displayHeight"),
    weight: sAt(a, "displayWeight"),
    college: sAt(a, "college", "name"),
    draft: formatDraft(sAt(a, "displayDraft")),
    experience: sAt(a, "displayExperience"),
    batsThrows: sAt(a, "displayBatsThrows"),
    debutYear: i(at(a, "debutYear")),
    nationality: sAt(a, "citizenship"),
    link: linkWith(at(a, "links"), "playercard"),
  };
  const tiles = arr(at(a, "statsSummary", "statistics")).flatMap((stat): StatTile[] => {
    const value = sAt(stat, "displayValue");
    if (value == null) return [];
    const lbl = sAt(stat, "abbreviation") ?? sAt(stat, "shortDisplayName") ?? "";
    // Soccer's "7 (2)": 7 starts, the 2 off the bench said in words below.
    if (lbl === "START (SUB)") {
      const numbers = value.split(/\D+/).filter(Boolean).map(Number);
      const subs = numbers.length === 2 && numbers[1]! > 0 ? `+${numbers[1]} off the bench` : null;
      return [{ label: "STARTS", value: numbers[0] != null ? String(numbers[0]) : value, rank: subs }];
    }
    return [{ label: lbl, value, rank: profileRank(sAt(stat, "rankDisplayValue"))?.text ?? null }];
  });
  const injuryJSON = at(a, "injuries", 0);
  const status = sAt(injuryJSON, "status");
  let injury: InjuryNote | null = null;
  if (status && status.toLowerCase() !== "active") {
    const details = at(injuryJSON, "details");
    const side = sAt(details, "side");
    const detail = [side && !["Not Specified", ""].includes(side) ? side : null, sAt(details, "type")].filter(Boolean).join(" ");
    injury = { status, detail: detail ? capitalizedFirst(detail) : null, returnDate: parseDate(sAt(details, "returnDate")) };
  }
  return { bio, tiles, tilesCaption: sAt(a, "statsSummary", "displayName"), injury };
}

/** "2003: Rd 1, Pk 1 (CLE)" → "2003 · Round 1, Pick 1 · CLE". */
export function formatDraft(text: string | null): string | null {
  if (!text) return text;
  const colon = text.indexOf(":");
  if (colon < 0) return text;
  const year = text.slice(0, colon);
  const rest = text.slice(colon + 1).trim();
  let team: string | null = null;
  let pick = rest;
  const open = rest.indexOf("(");
  const close = rest.indexOf(")");
  if (open >= 0 && close > open) {
    team = rest.slice(open + 1, close);
    pick = rest.slice(0, open).trim();
  }
  pick = pick.replaceAll("Rd ", "Round ").replaceAll("Pk ", "Pick ");
  return [year, pick, ...(team ? [team] : [])].join(" · ");
}

/** The core athlete: ISO birth date (the v3 `displayDOB` is day-first) and the cheap bio college uses. */
export function mergeCoreAthlete(json: JSONValue, bio: Bio): Bio {
  const next: { -readonly [K in keyof Bio]: Bio[K] } = { ...bio };
  const born = parseDate(sAt(json, "dateOfBirth"));
  if (born != null) next.birthDate = born;
  if (next.birthPlace == null) {
    const place = at(json, "birthPlace");
    next.birthPlace = nonEmpty([sAt(place, "city"), sAt(place, "state") ?? sAt(place, "country")].filter(Boolean).join(", "));
  }
  next.age = next.age ?? i(at(json, "age"));
  next.height = next.height ?? sAt(json, "displayHeight");
  next.weight = next.weight ?? sAt(json, "displayWeight");
  next.jersey = next.jersey ?? sAt(json, "jersey");
  next.position = next.position ?? sAt(json, "position", "displayName");
  next.positionAbbreviation = next.positionAbbreviation ?? sAt(json, "position", "abbreviation");
  if (next.classYear == null) next.classYear = sAt(json, "experience", "displayValue");
  if (next.draft == null) {
    const year = i(at(json, "draft", "year"));
    const round = i(at(json, "draft", "round"));
    const pick = i(at(json, "draft", "selection"));
    if (year != null && round != null && pick != null) next.draft = `${year} · Round ${round}, Pick ${pick}`;
  }
  return next;
}

export interface OverviewData {
  readonly season: StatTable | null;
  readonly competitions: StatTable | null;
  readonly note: Note | null;
  readonly awards: readonly string[];
}

/** One row per competition, domestic league first, international last. */
function competitionWeight(title: string): number {
  const t = title.toLowerCase();
  if (t.includes("world cup") || t.includes("nations") || t.includes("international") || t.includes("qualif") || t.includes("euro ") || t.includes("copa am")) return 4;
  if (t.includes("champions") || t.includes("europa") || t.includes("conference league")) return 1;
  if (t.includes("cup") || t.includes("shield") || t.includes("copa") || t.includes("pokal") || t.includes("coupe") || t.includes("supercup") || t.includes("super cup")) return 2;
  return 0;
}

export function parseOverview(json: JSONValue, sport: Sport): OverviewData {
  const st = at(json, "statistics");
  const labels = arr(at(st, "labels")).map((l) => label(s(l)));
  const names = arr(at(st, "names")).flatMap((n) => s(n) ?? []);
  let rows = arr(at(st, "splits")).flatMap((split) => {
    const title = sAt(split, "displayName");
    return title && title !== "Projected" ? [{ title, values: arr(at(split, "stats")).map((v) => s(v) ?? "") }] : [];
  });
  let season: StatTable | null = null;
  let competitions: StatTable | null = null;
  if (sport === "soccer") {
    rows = rows
      .map((row, offset) => ({ row, offset }))
      .sort((a, b2) => compareTuples([competitionWeight(a.row.title), a.offset], [competitionWeight(b2.row.title), b2.offset]))
      .map(({ row }) => ({ title: competitionName(row.title), values: row.values }));
    competitions = rows.length > 0 ? { columns: labels, keys: names, rows } : null;
  } else if (rows.length > 0) {
    season = { columns: labels, keys: names, rows };
  }
  const r = at(json, "rotowire");
  const headline = sAt(r, "headline");
  const note = headline ? { headline, story: sAt(r, "story"), published: rotowireDate(sAt(r, "published")) } : null;
  const awards = arr(at(json, "awards")).flatMap((a) => {
    const name = sAt(a, "name");
    if (!name) return [];
    return [[sAt(a, "displayCount")?.replaceAll("x", "×"), name].filter(Boolean).join(" ")];
  });
  return { season, competitions, note, awards };
}

/** "2026-27 English Premier League" → "Premier League". */
export function competitionName(text: string): string {
  let t = text;
  const space = t.indexOf(" ");
  if (space > 0 && /^[\d-]+$/.test(t.slice(0, space))) t = t.slice(space + 1);
  for (const prefix of ["English ", "Spanish ", "German ", "Italian ", "French ", "UEFA "]) {
    if (t.startsWith(prefix)) t = t.slice(prefix.length);
  }
  return t;
}

/** The game log, joined with its events map, in date order, preseason excluded. */
export function parseGameLog(json: JSONValue, path: string, position: string | null, pitching = false): GameLog | null {
  const sport = sportOfPath(path);
  const names = arr(at(json, "names")).flatMap((n) => s(n) ?? []);
  const labels = arr(at(json, "labels")).map((l) => label(s(l)));
  if (names.length === 0) return null;
  const events = at(json, "events");
  let list: GameLogEntry[] = [];
  for (const type of arr(at(json, "seasonTypes"))) {
    const typeName = (sAt(type, "displayName") ?? "").toLowerCase();
    if (typeName.includes("preseason")) continue;
    const postseason = typeName.includes("postseason");
    for (const category of arr(at(type, "categories"))) {
      for (const e of arr(at(category, "events"))) {
        const id = sAt(e, "eventId");
        if (!id) continue;
        const ev = at(events, id);
        const date = parseDate(sAt(ev, "gameDate"));
        if (date == null) continue;
        const stats: Record<string, string> = {};
        arr(at(e, "stats")).forEach((value, k) => {
          const key = names[k];
          const v = s(value);
          if (key != null && stats[key] == null && v != null) stats[key] = v;
        });
        const o = at(ev, "opponent");
        const oppID = sAt(o, "id");
        const homeID = sAt(ev, "homeTeamId");
        const home = homeID != null && homeID !== oppID;
        list.push({
          eventID: id,
          date,
          opponent: oppID
            ? teamRef({
                id: espnTeamID(path, sport, oppID),
                name: sAt(o, "displayName") ?? sAt(o, "abbreviation") ?? "",
                logo: sAt(o, "logo") ?? sAt(o, "logos", 0, "href"),
                abbreviation: sAt(o, "abbreviation"),
                league: leagueForPath(path),
              })
            : null,
          home,
          result: sAt(ev, "gameResult"),
          teamScore: home ? sAt(ev, "homeTeamScore") : sAt(ev, "awayTeamScore"),
          opponentScore: home ? sAt(ev, "awayTeamScore") : sAt(ev, "homeTeamScore"),
          stats,
          postseason,
          competition: sAt(ev, "leagueShortName") ?? sAt(ev, "leagueName"),
          played: true,
        });
      }
    }
  }
  const seen = new Set<string>();
  list = list
    .sort((a, b2) => a.date - b2.date)
    .filter((e) => {
      if (seen.has(e.eventID)) return false;
      seen.add(e.eventID);
      return true;
    });
  const columns: GameLogColumn[] = [];
  const used = new Set<string>();
  names.forEach((key, k) => {
    if (k < labels.length && !used.has(key)) {
      used.add(key);
      columns.push({ key, label: labels[k]! });
    }
  });
  let stripKey: string | null = null;
  let stripLabel = "";
  let markKey: string | null = null;
  let reference: number | null = null;
  let referenceLabel: string | null = null;
  let matchStrip = false;
  const pos = (position ?? "").toUpperCase();
  switch (sport) {
    case "basketball":
      [stripKey, stripLabel] = ["points", "Points"];
      break;
    case "football": {
      const preferred: [string, string][] =
        pos === "QB" ? [["passingYards", "Passing yards"]]
          : pos === "RB" || pos === "FB" ? [["rushingYards", "Rushing yards"]]
            : pos === "WR" || pos === "TE" ? [["receivingYards", "Receiving yards"]]
              : pos === "PK" || pos === "K" ? [["totalKickingPoints", "Points"]]
                : [["totalTackles", "Tackles"]];
      const fallback: [string, string][] = [["passingYards", "Passing yards"], ["rushingYards", "Rushing yards"], ["receivingYards", "Receiving yards"], ["totalTackles", "Tackles"]];
      const pick = [...preferred, ...fallback].find(([key]) => names.includes(key));
      if (pick) [stripKey, stripLabel] = pick;
      break;
    }
    case "baseball":
      if (pitching || names.includes("innings")) {
        if (pos === "SP" || list.some((e) => (Number(e.stats.innings ?? "") || 0) >= 4)) {
          [stripKey, stripLabel] = ["avgGameScore", "Game Score"];
          reference = 50;
          referenceLabel = "50 avg start";
        }
      } else {
        [stripKey, stripLabel] = ["hits", "Hits"];
        markKey = "homeRuns";
      }
      break;
    case "soccer":
      matchStrip = true;
      if (names.includes("cleanSheet")) {
        [stripKey, stripLabel] = ["cleanSheet", "Clean sheets"];
      } else {
        [stripKey, stripLabel] = ["totalGoals", "Goals"];
        markKey = "goalAssists";
      }
      break;
    default:
      break;
  }
  const filter = (name: string) => sAt(arr(at(json, "filters")).find((f) => sAt(f, "name") === name), "value");
  return {
    columns,
    entries: list,
    stripKey,
    stripLabel,
    markKey,
    reference,
    referenceLabel,
    matchStrip,
    season: filter("season"),
    category: filter("category"),
  };
}

/** Career by season (US sports): the averages category, newest first. */
export function parseCareer(json: JSONValue): StatTable | null {
  const c = at(json, "categories", 0);
  const labels = arr(at(c, "labels")).map((l) => label(s(l)));
  const names = arr(at(c, "names")).flatMap((n) => s(n) ?? []);
  if (labels.length === 0) return null;
  const abbreviations = new Map<string, string>();
  for (const [, value] of entries(at(json, "teams"))) {
    const id = sAt(value, "id");
    const abbr = sAt(value, "abbreviation");
    if (id && abbr) abbreviations.set(id, abbr);
  }
  const rows = [...arr(at(c, "statistics"))].reverse().flatMap((stat) => {
    const season = sAt(stat, "season", "displayName");
    if (!season) return [];
    const teamID = sAt(stat, "teamId");
    const team = teamID ? abbreviations.get(teamID) : undefined;
    return [{ title: [season, team].filter(Boolean).join(" · "), values: arr(at(stat, "stats")).map((v) => s(v) ?? "") }];
  });
  return { columns: labels, keys: names, rows };
}

// MARK: - Fills (ProfileStore.swift `PlayerState`)

/** College has no ranked summary: the season line's headline stats, by position. */
export function collegeTiles(season: StatTable | null, position: string | null): { tiles: StatTile[]; caption: string | null } | null {
  const row = season?.rows[0];
  if (!season || !row) return null;
  const pos = (position ?? "").toUpperCase();
  const keys: [string, string][] =
    pos === "QB" ? [["passingYards", "YDS"], ["passingTouchdowns", "TD"], ["interceptions", "INT"], ["QBRating", "RTG"]]
      : pos === "RB" || pos === "FB" ? [["rushingYards", "YDS"], ["rushingTouchdowns", "TD"], ["rushingAttempts", "CAR"], ["yardsPerRushAttempt", "AVG"]]
        : pos === "WR" || pos === "TE" ? [["receptions", "REC"], ["receivingYards", "YDS"], ["receivingTouchdowns", "TD"], ["yardsPerReception", "AVG"]]
          : [["totalTackles", "TOT"], ["sacks", "SACK"], ["interceptions", "INT"], ["passesDefended", "PD"]];
  const tiles = keys.flatMap(([key, lbl]) => {
    const k = season.keys.indexOf(key);
    return k >= 0 && k < row.values.length ? [{ label: lbl, value: row.values[k]!, rank: null }] : [];
  });
  // The career table's row is just the year ("2026"): say what it is.
  return { tiles, caption: /^\d+$/.test(row.title) ? `${row.title} season stats` : row.title };
}

const LEAGUE_RANK_CATEGORIES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "basketball/nba": { PTS: "pointsPerGame", REB: "reboundsPerGame", AST: "assistsPerGame", "FG%": "fieldGoalPercentage", STL: "stealsPerGame", BLK: "blocksPerGame" },
  soccer: { G: "goals", A: "assists" },
};

/** NBA and soccer: ESPN's summary has no ranks, so a top-25 place in the league leaders stands in. */
export function applyLeagueRanks(tiles: readonly StatTile[], leaders: Leaders, path: string, athleteID: string): readonly StatTile[] {
  const categories = path === "basketball/nba" ? LEAGUE_RANK_CATEGORIES["basketball/nba"]! : LEAGUE_RANK_CATEGORIES.soccer!;
  let changed = false;
  const next = tiles.map((tile) => {
    const category = categories[tile.label];
    if (tile.rank != null || !category) return tile;
    const index = (leaders[category] ?? []).findIndex((l) => l.id === athleteID);
    if (index < 0) return tile;
    changed = true;
    return { ...tile, rank: ordinalRank(index + 1) };
  });
  return changed ? next : tiles;
}

function ordinalRank(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** An ESPN player with a page (NBA, NFL, college football, MLB, soccer; not the WNBA or college basketball), from a match page's IDs. */
export function espnPlayerRef(path: string | null | undefined, id: string | null | undefined, name: string, fields: Partial<PlayerRef> = {}): PlayerRef | null {
  if (!path || !id) return null;
  if (!["basketball/nba", "football/nfl", "football/college-football", "baseball/mlb"].includes(path) && !path.startsWith("soccer/")) return null;
  return playerRef({ ...fields, source: { kind: "espn", path }, id, name });
}

