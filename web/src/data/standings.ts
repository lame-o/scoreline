/**
 * League tables: the parsers, the live projection and the layout rules.
 * Ported from LiveFeeds.swift (`StandingsRow`, `LiveStandingsRow`,
 * `Standings`), LiveViews.swift (`StandingsTable`: columns by width, zone
 * lines), Basketball.swift (`NBAStandings`), College.swift
 * (`ConferenceTable.Columns`, `ConferenceLeaderLine`) and ListLayout.swift
 * (`TableGroup`, `GroupPlacement`). Pure: no DOM.
 *
 * Which leagues have a table (Standings.fetch): soccer (one table, or its
 * groups), college football (conference tables) and the NBA (both
 * conferences by seed). Everything else has none, as on the Mac.
 */
import { arr, at, num, str, type JSONValue } from "./json";
import type { Fetcher } from "./http";
import { espnPath } from "./leagues";
import { enDash, ordinal, spokenRecord } from "./format";
import { isKnockout, type League, type ScoreEvent } from "./models";
import { rankingsPath, standingsPath } from "./schedule";
import { espnTeamID } from "./teams";

export const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports";
const NBA_PATH = "basketball/nba";

// MARK: - Rows

export interface StandingsRow {
  /** Same format as `Competitor.id` ("espn-soccer-382"). */
  readonly id: string;
  /** Conference or group ("Eastern Conference", "Group A"); null for a single table. */
  readonly group: string | null;
  readonly name: string;
  readonly abbreviation: string;
  readonly logo: string | null;
  readonly rank: number;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalDifference: number;
  readonly goalsFor: number;
  readonly points: number;
  /** College: the conference a division's table belongs to ("Sun Belt" for "Sun Belt · East"). */
  readonly parentGroup: string | null;
  /** College: season and conference records ("7-1", "4-1") and streak ("W5"). */
  readonly overall: string | null;
  readonly conference: string | null;
  readonly streak: string | null;
  /** NBA: games behind ("-", "2.5"), win percentage and the last ten ("7-3"). */
  readonly gamesBehind: string | null;
  readonly winPercent: number | null;
  readonly lastTen: string | null;
  /** Every stat ESPN sends, by its name or type, for wider tables. */
  readonly details: Readonly<Record<string, string>>;
  /** Soccer: what this *position* earns ("Champions League", "Relegation"). It belongs to the place, not the team. */
  readonly zone: string | null;
}

function standingsRow(r: Partial<StandingsRow> & Pick<StandingsRow, "id" | "name" | "rank">): StandingsRow {
  return {
    group: null,
    abbreviation: "",
    logo: null,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalDifference: 0,
    goalsFor: 0,
    points: 0,
    parentGroup: null,
    overall: null,
    conference: null,
    streak: null,
    gamesBehind: null,
    winPercent: null,
    lastTen: null,
    details: {},
    zone: null,
    ...r,
  };
}

/** Exposed for tests and the page's placeholders. */
export const makeStandingsRow = standingsRow;

/**
 * A standings row adjusted for games in progress: every count moves together,
 * so a live 2–1 lead is +1 played, +1 won, +3 points, +2 for and +1 against.
 */
export interface LiveStandingsRow {
  readonly id: string;
  readonly row: StandingsRow;
  readonly liveRank: number;
  readonly points: number;
  readonly goalDifference: number;
  readonly played: number;
  readonly wins: number;
  readonly draws: number;
  readonly losses: number;
  readonly goalsFor: number;
  /** Derived, so it always agrees with GF and GD. */
  readonly goalsAgainst: number;
  /** What the live position earns (the zone of the place, after re-ranking). */
  readonly zone: string | null;
  /** Positive = climbing (official rank − live rank). */
  readonly movement: number;
  /** "2–1" from this team's side, while its game is live. */
  readonly liveScore: string | null;
  /** Place in its table, from 0. ESPN's ranks can repeat for teams level on points, so gaps are judged by position. */
  readonly position: number;
}

// MARK: - Fetching (Standings.fetch, ScoreStore.standings)

/** The table's URL, or null for a league without one. */
export function standingsURL(league: League): string | null {
  const path = espnPath(league);
  if (!path) return null;
  if (path === NBA_PATH) return `${ESPN_STANDINGS}/${path}/standings?sort=playoffseed:asc`;
  if (path.endsWith("college-football") || league.sport === "soccer") return `${ESPN_STANDINGS}/${path}/standings`;
  return null;
}

export type TableKind = "soccer" | "college" | "nba" | "none";

export function tableKind(league: League): TableKind {
  const path = espnPath(league);
  if (!path) return "none";
  if (path.endsWith("college-football")) return "college";
  if (path === NBA_PATH) return "nba";
  return league.sport === "soccer" ? "soccer" : "none";
}

/**
 * A league's ways to its tables, as the scores list's section menu offers
 * them (ScoresView.swift): soccer, "Table"; college football, "Standings"
 * and "Top 25"; the NBA, "Standings". `ring` lights teams (a match's).
 */
export function tableLinks(league: League, ring: readonly (string | null)[] = []): { readonly label: string; readonly path: string; readonly icon: "list" | "trophy" }[] {
  switch (tableKind(league)) {
    case "soccer":
      return [{ label: "Table", path: standingsPath(league.id, ring), icon: "list" }];
    case "college":
      return [
        { label: "Standings", path: standingsPath(league.id, ring), icon: "list" },
        { label: "Top 25", path: rankingsPath(league.id), icon: "trophy" },
      ];
    case "nba":
      return [{ label: "Standings", path: standingsPath(league.id, ring), icon: "list" }];
    default:
      return [];
  }
}

export async function fetchStandings(league: League, fetcher: Fetcher, signal?: AbortSignal): Promise<StandingsRow[]> {
  const url = standingsURL(league);
  const path = espnPath(league);
  if (!url || !path) return [];
  const json = await fetcher(url, { signal });
  switch (tableKind(league)) {
    case "college":
      return parseCollege(json, path);
    case "nba":
      return parseNBA(json);
    case "soccer":
      return parseSoccer(json);
    default:
      return [];
  }
}

// MARK: - Soccer

/** A soccer table (or its groups), sorted by group then rank. */
export function parseSoccer(json: JSONValue): StandingsRow[] {
  const children = arr(at(json, "children"));
  const grouped = children.length > 1;
  const rows = children.flatMap((child) =>
    arr(at(child, "standings", "entries")).flatMap((e): StandingsRow[] => {
      const teamID = str(at(e, "team", "id"));
      if (!teamID) return [];
      const stats: Record<string, number> = {};
      for (const s of arr(at(e, "stats"))) {
        const name = str(at(s, "name"));
        const value = intValue(at(s, "value")) ?? intValue(Number(str(at(s, "displayValue"))));
        if (name && value != null) stats[name] = value;
      }
      const zone = str(at(e, "note", "description"))?.trim();
      return [
        standingsRow({
          id: `espn-soccer-${teamID}`,
          group: grouped ? (str(at(child, "name")) ?? null) : null,
          name: str(at(e, "team", "shortDisplayName")) ?? str(at(e, "team", "displayName")) ?? "",
          abbreviation: str(at(e, "team", "abbreviation")) ?? "",
          logo: str(at(e, "team", "logos", 0, "href")) ?? null,
          rank: stats.rank ?? 0,
          played: stats.gamesPlayed ?? 0,
          wins: stats.wins ?? 0,
          draws: stats.ties ?? 0,
          losses: stats.losses ?? 0,
          goalDifference: stats.pointDifferential ?? 0,
          goalsFor: stats.pointsFor ?? 0,
          points: stats.points ?? 0,
          zone: zone ? zone : null,
        }),
      ];
    }),
  );
  return rows.sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.rank - b.rank);
}

/** A whole-number reading (JSONSerialization's `int`): 8.0 → 8. */
function intValue(value: JSONValue): number | undefined {
  const n = num(value);
  return n != null && Number.isInteger(n) ? n : undefined;
}

// MARK: - College

/** "4-1" → 0.8; no games → 0. */
function pct(record: string | undefined): number {
  const parts = (record ?? "").split("-").map(Number).filter((n) => Number.isFinite(n));
  if (parts.length < 2 || parts[0]! + parts[1]! <= 0) return 0;
  return parts[0]! / (parts[0]! + parts[1]!);
}

/**
 * College football by conference (and division, where a conference has
 * them), ranked by conference record: ESPN's order isn't always by record,
 * so conference win rate, then overall, then ESPN's order.
 */
export function parseCollege(json: JSONValue, path: string): StandingsRow[] {
  const rows: StandingsRow[] = [];
  const add = (table: JSONValue, group: string, parent: string | null) => {
    const entries = arr(at(table, "standings", "entries"))
      .map((e, offset) => {
        const records: Record<string, string> = {};
        for (const s of arr(at(e, "stats"))) {
          const type = str(at(s, "type"));
          const value = str(at(s, "displayValue"));
          if (type && value != null) records[type] = value;
        }
        return { e, records, offset };
      })
      .sort((a, b) => {
        const ca = pct(a.records.vsconf);
        const cb = pct(b.records.vsconf);
        if (ca !== cb) return cb - ca;
        const oa = pct(a.records.total);
        const ob = pct(b.records.total);
        if (oa !== ob) return ob - oa;
        return a.offset - b.offset;
      });
    entries.forEach(({ e, records }, index) => {
      const teamID = str(at(e, "team", "id"));
      if (!teamID) return;
      rows.push(
        standingsRow({
          id: espnTeamID(path, "football", teamID),
          group,
          name: str(at(e, "team", "location")) ?? str(at(e, "team", "shortDisplayName")) ?? str(at(e, "team", "displayName")) ?? "",
          abbreviation: str(at(e, "team", "abbreviation")) ?? "",
          logo: str(at(e, "team", "logos", 0, "href")) ?? null,
          rank: index + 1,
          parentGroup: parent,
          overall: records.total ?? null,
          conference: records.vsconf ?? null,
          streak: records.streak ?? null,
          // Every split ESPN sends (home, away, points for and against), for wider tables.
          details: records,
        }),
      );
    });
  };
  for (const conference of arr(at(json, "children"))) {
    const name = str(at(conference, "shortName")) ?? str(at(conference, "name")) ?? "";
    const divisions = arr(at(conference, "children"));
    if (divisions.length === 0) add(conference, name, null);
    // "Sun Belt - East" → "Sun Belt · East".
    else for (const division of divisions) add(division, (str(at(division, "name")) ?? name).replaceAll(" - ", " · "), name);
  }
  return rows;
}

// MARK: - The live projection (Standings.live)

/** A live game's effect on one side's line, as if it ended now. */
export interface LiveResult {
  readonly points: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly score: string;
}

export function liveResult(scored: number, conceded: number): LiveResult {
  return {
    points: scored > conceded ? 3 : scored === conceded ? 1 : 0,
    won: scored > conceded ? 1 : 0,
    drawn: scored === conceded ? 1 : 0,
    lost: scored < conceded ? 1 : 0,
    goalsFor: scored,
    goalsAgainst: conceded,
    score: `${scored}–${conceded}`,
  };
}

function intScore(score: string | null): number | null {
  return score != null && /^\d+$/.test(score) ? Number(score) : null;
}

/** Groups in first-appearance order. */
function groupsOf<R>(rows: readonly R[], group: (r: R) => string | null): (string | null)[] {
  const out: (string | null)[] = [];
  for (const r of rows) if (!out.includes(group(r))) out.push(group(r));
  return out;
}

/**
 * The table as it would stand if live games ended now: provisional points,
 * record and goals, re-ranked on points, goal difference, goals for. Each
 * conference or group is its own table: projected within it, in its order.
 */
export function liveTable(rows: readonly StandingsRow[], liveEvents: readonly ScoreEvent[]): LiveStandingsRow[] {
  const groups = groupsOf(rows, (r) => r.group);
  if (groups.length > 1) return groups.flatMap((g) => project(rows.filter((r) => r.group === g), liveEvents));
  return project(rows, liveEvents);
}

function project(rows: readonly StandingsRow[], liveEvents: readonly ScoreEvent[]): LiveStandingsRow[] {
  const adjust = new Map<string, LiveResult>();
  // Knockout ties are played outside the league table.
  for (const event of liveEvents) {
    if (event.state !== "live" || isKnockout(event) || event.content.kind !== "match") continue;
    const { top, bottom } = event.content;
    const sa = intScore(top.score);
    const sb = intScore(bottom.score);
    if (!top.id || !bottom.id || sa == null || sb == null) continue;
    adjust.set(top.id, liveResult(sa, sb));
    adjust.set(bottom.id, liveResult(sb, sa));
  }
  const projected = rows.map((row) => {
    const a = adjust.get(row.id);
    return {
      row,
      points: row.points + (a?.points ?? 0),
      goalDifference: row.goalDifference + (a ? a.goalsFor - a.goalsAgainst : 0),
      played: row.played + (a ? 1 : 0),
      wins: row.wins + (a?.won ?? 0),
      draws: row.draws + (a?.drawn ?? 0),
      losses: row.losses + (a?.lost ?? 0),
      goalsFor: row.goalsFor + (a?.goalsFor ?? 0),
      liveScore: a?.score ?? null,
    };
  });
  // With nothing live, keep the official order (leagues break ties
  // differently: MLS on wins, not goal difference).
  const ordered =
    adjust.size === 0
      ? [...projected].sort((l, r) => l.row.rank - r.row.rank)
      : [...projected].sort(
          (l, r) => r.points - l.points || r.goalDifference - l.goalDifference || r.goalsFor - l.goalsFor || l.row.rank - r.row.rank,
        );
  // Zones belong to places: a team projected into 4th takes 4th's zone.
  const zoneAt = new Map<number, string>();
  for (const r of rows) if (r.zone && !zoneAt.has(r.rank)) zoneAt.set(r.rank, r.zone);
  return ordered.map((p, index) => {
    const rank = adjust.size === 0 ? p.row.rank : index + 1;
    return {
      id: p.row.id,
      row: p.row,
      liveRank: rank,
      points: p.points,
      goalDifference: p.goalDifference,
      played: p.played,
      wins: p.wins,
      draws: p.draws,
      losses: p.losses,
      goalsFor: p.goalsFor,
      goalsAgainst: p.goalsFor - p.goalDifference,
      zone: zoneAt.get(rank) ?? null,
      movement: p.row.rank - rank,
      liveScore: p.liveScore,
      position: index,
    };
  });
}

// MARK: - Groups and columns (TableGroup, GroupPlacement)

export interface TableGroup<R> {
  readonly title: string;
  readonly rows: readonly R[];
}

/** Rows split by group, in first-appearance order; rows keep their order. */
export function tableGroups<R>(rows: readonly R[], group: (r: R) => string | null): TableGroup<R>[] {
  const order: string[] = [];
  const by = new Map<string, R[]>();
  for (const row of rows) {
    const key = group(row) ?? "";
    let list = by.get(key);
    if (!list) {
      order.push(key);
      by.set(key, (list = []));
    }
    list.push(row);
  }
  return order.map((title) => ({ title, rows: by.get(title) ?? [] }));
}

/**
 * Each group goes into whichever column has fewer rows so far (the left on a
 * tie). Decided from row counts alone, never measured, so live re-ranking
 * never moves a group; a group never splits; each column keeps the source's order.
 */
export function groupColumns(sizes: readonly number[], columns = 2): number[][] {
  const placed: number[][] = Array.from({ length: Math.max(columns, 1) }, () => []);
  const rows = placed.map(() => 0);
  sizes.forEach((size, index) => {
    let target = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i]! < rows[target]!) target = i;
    placed[target]!.push(index);
    rows[target]! += size;
  });
  return placed;
}

// MARK: - Width classes

export type WidthClass = "compact" | "medium" | "large" | "xlarge";

/** The Mac's width classes from a block's content width in points (380, 460, 560). */
export function widthClassOf(points: number): WidthClass {
  return points >= 560 ? "xlarge" : points >= 460 ? "large" : points >= 380 ? "medium" : "compact";
}

const WIDTH_ORDER: Readonly<Record<WidthClass, number>> = { compact: 0, medium: 1, large: 2, xlarge: 3 };
export const atLeast = (w: WidthClass, min: WidthClass) => WIDTH_ORDER[w] >= WIDTH_ORDER[min];

// MARK: - The soccer table's columns (StandingsTable.Column)

export type TableColumn = "played" | "won" | "drawn" | "lost" | "goalsFor" | "goalsAgainst" | "goalDifference" | "points";

export const TABLE_COLUMNS: readonly TableColumn[] = ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"];

export const COLUMN_TITLE: Readonly<Record<TableColumn, string>> = {
  played: "P",
  won: "W",
  drawn: "D",
  lost: "L",
  goalsFor: "GF",
  goalsAgainst: "GA",
  goalDifference: "GD",
  points: "Pts",
};

export const COLUMN_HELP: Readonly<Record<TableColumn, string>> = {
  played: "Played",
  won: "Won",
  drawn: "Drawn",
  lost: "Lost",
  goalsFor: "Goals for",
  goalsAgainst: "Goals against",
  goalDifference: "Goal difference",
  points: "Points",
};

/** Points wide, in the order ESPN and the league print them. Room for "+101" and "103". */
export const COLUMN_WIDTH: Readonly<Record<TableColumn, number>> = {
  played: 22,
  won: 20,
  drawn: 20,
  lost: 20,
  goalsFor: 24,
  goalsAgainst: 24,
  goalDifference: 32,
  points: 32,
};

/** Compact keeps P, GD, Pts; each step adds the next most useful pair. */
export function tableColumns(width: WidthClass): TableColumn[] {
  switch (width) {
    case "compact":
      return ["played", "goalDifference", "points"];
    case "medium":
      return ["played", "won", "drawn", "lost", "goalDifference", "points"];
    default:
      return [...TABLE_COLUMNS];
  }
}

export function columnValue(c: TableColumn, r: LiveStandingsRow): string {
  switch (c) {
    case "played":
      return `${r.played}`;
    case "won":
      return `${r.wins}`;
    case "drawn":
      return `${r.draws}`;
    case "lost":
      return `${r.losses}`;
    case "goalsFor":
      return `${r.goalsFor}`;
    case "goalsAgainst":
      return `${r.goalsAgainst}`;
    case "goalDifference":
      return r.goalDifference > 0 ? `+${r.goalDifference}` : `${r.goalDifference}`;
    case "points":
      return `${r.points}`;
  }
}

/**
 * Whether a zone begins at this row, and its name (null label: mid-table
 * resumes). Compared with the row shown above it in the same group (across a
 * "…" gap too); the first row of a table starts its zone if it has one.
 */
export function zoneBoundary(index: number, rows: readonly LiveStandingsRow[]): { readonly label: string | null } | null {
  const here = rows[index];
  if (!here) return null;
  const prev = rows[index - 1];
  const above = index > 0 && prev && prev.row.group === here.row.group ? prev.zone : null;
  if ((above?.toLowerCase() ?? null) === (here.zone?.toLowerCase() ?? null)) return null;
  return { label: here.zone };
}

/** Zones only at xlarge, and only when ESPN marks them. */
export function showsZones(width: WidthClass, rows: readonly LiveStandingsRow[]): boolean {
  return width === "xlarge" && rows.some((r) => r.zone != null);
}

export function spokenTableRow(r: LiveStandingsRow, columns: readonly TableColumn[], zones: boolean, mine: boolean): string {
  const parts = [`${ordinal(r.liveRank)}, ${r.row.name}`, `${r.points} points`, `${r.played} played`];
  if (columns.includes("won")) parts.push(`${r.wins} won, ${r.draws} drawn, ${r.losses} lost`);
  if (columns.includes("goalsFor")) parts.push(`${r.goalsFor} goals for, ${r.goalsAgainst} against`);
  parts.push(`goal difference ${r.goalDifference}`);
  if (r.liveScore) parts.push(`playing now, ${r.liveScore}`);
  if (r.movement !== 0) parts.push(r.movement > 0 ? `up ${r.movement}` : `down ${-r.movement}`);
  if (zones && r.zone) parts.push(r.zone);
  if (mine) parts.push("your team");
  return parts.join(", ");
}

// MARK: - College: the conference table and leader line

/** ESPN's stat types, as the college parser keys them. */
export const COLLEGE_KEY = { home: "homerecord", away: "awayrecord", pointsFor: "pointsfor", pointsAgainst: "pointsagainst" } as const;

export interface ConferenceColumns {
  readonly streak: boolean;
  readonly homeAway: boolean;
  readonly points: boolean;
}

/**
 * Wider tables add columns, never bigger type: the streak from medium, home
 * and away records from large, points for and against from xlarge; each only
 * when the rows carry it.
 */
export function conferenceColumns(width: WidthClass, rows: readonly StandingsRow[]): ConferenceColumns {
  return {
    streak: atLeast(width, "medium") && rows.some((r) => r.streak != null),
    homeAway: atLeast(width, "large") && rows.some((r) => r.details[COLLEGE_KEY.home] != null),
    points: atLeast(width, "xlarge") && rows.some((r) => r.details[COLLEGE_KEY.pointsFor] != null),
  };
}

/** Live scores by team, from each team's side ("21–14"), for the table. */
export function liveScores(events: readonly ScoreEvent[]): Record<string, string> {
  const scores: Record<string, string> = {};
  for (const event of events) {
    if (event.state !== "live" || event.content.kind !== "match") continue;
    const { top, bottom } = event.content;
    if (top.score == null || bottom.score == null) continue;
    if (top.id) scores[top.id] = `${top.score}–${bottom.score}`;
    if (bottom.id) scores[bottom.id] = `${bottom.score}–${top.score}`;
  }
  return scores;
}

/** "W5" in words. */
export function spokenStreak(streak: string): string {
  const first = streak[0];
  const n = Number.parseInt(streak.slice(1), 10);
  if (!first || !Number.isFinite(n)) return `streak ${streak}`;
  switch (first) {
    case "W":
      return `won ${n} in a row`;
    case "L":
      return `lost ${n} in a row`;
    case "T":
      return `tied ${n} in a row`;
    default:
      return `streak ${streak}`;
  }
}

export function spokenConferenceRow(r: StandingsRow, columns: ConferenceColumns, rank: number | undefined, live: string | undefined): string {
  const parts: (string | null | undefined)[] = [
    `${ordinal(r.rank)}, ${r.name}`,
    rank != null ? `ranked ${rank}` : null,
    r.conference ? `${r.conference} in conference` : null,
    r.overall ? `${r.overall} overall` : null,
  ];
  if (columns.homeAway) parts.push(r.details[COLLEGE_KEY.home] && `${r.details[COLLEGE_KEY.home]} at home`, r.details[COLLEGE_KEY.away] && `${r.details[COLLEGE_KEY.away]} away`);
  if (columns.points) parts.push(r.details[COLLEGE_KEY.pointsFor] && `${r.details[COLLEGE_KEY.pointsFor]} points for`, r.details[COLLEGE_KEY.pointsAgainst] && `${r.details[COLLEGE_KEY.pointsAgainst]} against`);
  if (columns.streak && r.streak) parts.push(spokenStreak(r.streak));
  if (live) parts.push(`playing now, ${live}`);
  return parts.filter(Boolean).join(", ");
}

export type LeaderKind =
  /** Conference games played: the first row leads. */
  | "leader"
  /** None (independents): the first row has the best season record. */
  | "bestRecord"
  /** No games at all yet. */
  | "none";

function games(record: string | null): number {
  return (record ?? "")
    .split(/[-–]/)
    .map((p) => Number.parseInt(p, 10))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => a + b, 0);
}

/** A collapsed conference's one line: who leads it (the table ranks by conference record, so its first row). */
export function leaderKind(row: StandingsRow): LeaderKind {
  if (games(row.conference) > 0) return "leader";
  return games(row.overall) > 0 ? "bestRecord" : "none";
}

/** "7–0 · 5–0 Conf" */
export function leaderRecords(row: StandingsRow, kind: LeaderKind): string {
  return [row.overall ? enDash(row.overall) : null, kind === "leader" && row.conference ? `${enDash(row.conference)} Conf` : null].filter(Boolean).join(" · ");
}

/** "leader UCLA, ranked 4, 7 wins, 0 losses, 5 wins, 0 losses in conference". */
export function leaderSpoken(row: StandingsRow, rank?: number | null): string {
  const kind = leaderKind(row);
  if (kind === "none") return "no games yet";
  return [
    kind === "leader" ? `leader ${row.name}` : `best record ${row.name}`,
    rank != null ? `ranked ${rank}` : null,
    row.overall ? spokenRecord(row.overall, false) : null,
    kind === "leader" && row.conference ? `${spokenRecord(row.conference, false)} in conference` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * College conferences of the match first, then those with a followed team;
 * the rest keep ESPN's order (StandingsView.collegeRows).
 */
export function collegeOrder(rows: readonly StandingsRow[], focus: ReadonlySet<string>, mine: ReadonlySet<string>): StandingsRow[] {
  const match = new Set(rows.filter((r) => focus.has(r.id)).flatMap((r) => (r.group ? [r.group] : [])));
  const followed = new Set(rows.filter((r) => mine.has(r.id) && r.group && !match.has(r.group)).flatMap((r) => (r.group ? [r.group] : [])));
  const among = (groups: Set<string>) => rows.filter((r) => groups.has(r.group ?? ""));
  return [...among(match), ...among(followed), ...rows.filter((r) => !match.has(r.group ?? "") && !followed.has(r.group ?? ""))];
}

// MARK: - NBA (Basketball.swift `NBAStandings`)

/** Both conferences, each by playoff seed (ESPN's entries aren't in seed order). */
export function parseNBA(json: JSONValue): StandingsRow[] {
  return arr(at(json, "children")).flatMap((conference) => {
    const group = str(at(conference, "name")) ?? null;
    const rows = arr(at(conference, "standings", "entries")).flatMap((e): StandingsRow[] => {
      const teamID = str(at(e, "team", "id"));
      if (!teamID) return [];
      const values: Record<string, number> = {};
      const texts: Record<string, string> = {};
      for (const s of arr(at(e, "stats"))) {
        const name = str(at(s, "name")) ?? str(at(s, "type"));
        if (!name) continue;
        const value = num(at(s, "value"));
        if (value != null) values[name] = value;
        const display = str(at(s, "displayValue")) ?? str(at(s, "summary"));
        if (display != null) texts[name] = display;
      }
      const wins = Math.trunc(values.wins ?? 0);
      const losses = Math.trunc(values.losses ?? 0);
      return [
        standingsRow({
          id: espnTeamID(NBA_PATH, "basketball", teamID),
          group,
          name: str(at(e, "team", "shortDisplayName")) ?? str(at(e, "team", "displayName")) ?? "",
          abbreviation: str(at(e, "team", "abbreviation")) ?? "",
          logo: str(at(e, "team", "logos", 0, "href")) ?? null,
          rank: Math.trunc(values.playoffSeed ?? 0),
          played: wins + losses,
          wins,
          losses,
          goalDifference: Math.trunc(values.pointDifferential ?? 0),
          goalsFor: Math.trunc(values.pointsFor ?? 0),
          overall: texts.overall ?? null,
          streak: texts.streak ?? null,
          gamesBehind: texts.gamesBehind ?? null,
          winPercent: values.winPercent ?? null,
          lastTen: texts["Last Ten Games"] ?? null,
          details: texts,
        }),
      ];
    });
    const seed = (r: StandingsRow) => (r.rank === 0 ? Number.MAX_SAFE_INTEGER : r.rank);
    return rows.sort((a, b) => seed(a) - seed(b));
  });
}

/** A row as it would stand if live games ended now. */
export interface NBALiveRow {
  readonly id: string;
  readonly row: StandingsRow;
  readonly liveRank: number;
  readonly wins: number;
  readonly losses: number;
  /** "88–84" from this team's side, while its game is live. */
  readonly liveScore: string | null;
  /** Games behind the conference leader ("–" for the leader). */
  readonly gamesBehind: string;
  /** Positive = climbing (official seed − projected place). */
  readonly movement: number;
  /** ".732", "1.000". */
  readonly percentText: string;
}

/** 0 → "–", 2.5 → "2.5", 3 → "3". */
export function gamesBehindText(value: number): string {
  if (value <= 0) return "–";
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function percentText(wins: number, losses: number): string {
  const p = wins + losses === 0 ? 0 : wins / (wins + losses);
  const t = p.toFixed(3);
  return t.startsWith("0") ? t.slice(1) : t;
}

/**
 * Each conference re-ranked by win percentage if live games ended now: the
 * team ahead gets the win, the team behind the loss (a tie changes nothing).
 * Equal percentages go by games over .500, then ESPN's seeding. With nothing
 * live, ESPN's own order and games behind stand.
 */
export function projectNBA(rows: readonly StandingsRow[], liveEvents: readonly ScoreEvent[]): NBALiveRow[] {
  const result = new Map<string, { win: boolean | null; score: string }>();
  for (const event of liveEvents) {
    if (event.state !== "live" || event.content.kind !== "match") continue;
    const { top, bottom } = event.content;
    const sa = intScore(top.score);
    const sb = intScore(bottom.score);
    if (!top.id || !bottom.id || sa == null || sb == null) continue;
    result.set(top.id, { win: sa === sb ? null : sa > sb, score: `${sa}–${sb}` });
    result.set(bottom.id, { win: sa === sb ? null : sb > sa, score: `${sb}–${sa}` });
  }
  const p = (w: number, l: number) => (w + l === 0 ? 0 : w / (w + l));
  return groupsOf(rows, (r) => r.group).flatMap((group) => {
    const table = rows.filter((r) => r.group === group);
    const changed = table.some((r) => result.get(r.id)?.win != null);
    const projected = table.map((row) => {
      const r = result.get(row.id);
      return { row, wins: row.wins + (r?.win === true ? 1 : 0), losses: row.losses + (r?.win === false ? 1 : 0), score: r?.score ?? null };
    });
    const ordered = changed
      ? [...projected].sort((a, b) => {
          const pa = p(a.wins, a.losses);
          const pb = p(b.wins, b.losses);
          if (pa !== pb) return pb - pa;
          if (a.wins - a.losses !== b.wins - b.losses) return b.wins - b.losses - (a.wins - a.losses);
          return a.row.rank - b.row.rank;
        })
      : projected;
    const leader = ordered[0];
    return ordered.map((x, index) => {
      const behind = leader ? (leader.wins - x.wins + (x.losses - leader.losses)) / 2 : 0;
      const official = x.row.gamesBehind == null ? null : x.row.gamesBehind === "-" || x.row.gamesBehind === "0" ? "–" : x.row.gamesBehind;
      const liveRank = changed ? index + 1 : x.row.rank;
      return {
        id: x.row.id,
        row: x.row,
        liveRank,
        wins: x.wins,
        losses: x.losses,
        liveScore: x.score,
        gamesBehind: changed ? gamesBehindText(behind) : (official ?? gamesBehindText(behind)),
        movement: x.row.rank - liveRank,
        percentText: percentText(x.wins, x.losses),
      };
    });
  });
}

/** Each team's conference around it: `reach` places either side (both conferences for an East–West game), in order. */
export function nbaWindow(rows: readonly NBALiveRow[], ids: ReadonlySet<string>, reach = 2): NBALiveRow[] {
  const groups = new Set(rows.filter((r) => ids.has(r.id)).map((r) => r.row.group));
  if (groups.size === 0) return [];
  const table = rows.filter((r) => groups.has(r.row.group));
  const keep = new Set<number>();
  table.forEach((r, p) => {
    if (!ids.has(r.id)) return;
    for (let i = p - reach; i <= p + reach; i++) if (table[i] && table[i]!.row.group === r.row.group) keep.add(i);
  });
  return table.filter((_, i) => keep.has(i));
}

/** Where a zone line goes above a seed: the play-in starts at 7, the lottery at 11. */
export function nbaZone(previousRank: number): { readonly label: string; readonly help: string } | null {
  if (previousRank === 6) return { label: "Play-in", help: "Seeds 7–10 play in for the last four playoff places" };
  if (previousRank === 10) return { label: "Lottery", help: "Seeds 11–15 miss the postseason" };
  return null;
}

export function spokenNBARow(r: NBALiveRow): string {
  const parts = [`${ordinal(r.liveRank)}, ${r.row.name}`, `${r.wins} and ${r.losses}`, r.gamesBehind === "–" ? "leads the conference" : `${r.gamesBehind} games behind`];
  if (r.liveScore) parts.push(`playing now, ${r.liveScore}`);
  if (r.movement !== 0) parts.push(r.movement > 0 ? `up ${r.movement}` : `down ${-r.movement}`);
  return parts.join(", ");
}
