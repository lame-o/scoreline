/**
 * Playoff brackets and tournament stages (Brackets.swift): the MLB
 * postseason rebuilt from ESPN's daily scoreboards, and CS2 tournaments
 * (a Swiss stage and a playoff tree) from bo3.gg, S-tier like everything
 * else. The model, the parsers, the tree's layout and the reading of it are
 * pure; fetching takes a `Fetcher`.
 */
import { arr, at, bool, int, str, type JSONValue } from "./json";
import type { Fetcher } from "./http";
import { dayAndTime, plural } from "./format";
import { parseDate } from "./providers/espn";
import { abbreviate } from "./providers/counterStrike";

// MARK: - Model

export interface BracketTeam {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly logo: string | null;
}

export type BracketSide = "top" | "bottom";

/** One matchup: a single match (CS2) or a whole series (MLB). */
export interface BracketMatch {
  readonly id: string;
  readonly top: BracketTeam | null;
  readonly bottom: BracketTeam | null;
  /** Maps or games won. */
  readonly topScore: number | null;
  readonly bottomScore: number | null;
  readonly winner: BracketSide | null;
  readonly live: boolean;
  /** "MIL leads 2–1", "Best of 3 · Oct 29". */
  readonly note: string | null;
  /** Matchups whose winners play in this one, top first. */
  readonly feeders: readonly string[];
}

export function bracketMatch(m: Partial<BracketMatch> & Pick<BracketMatch, "id">): BracketMatch {
  return { top: null, bottom: null, topScore: null, bottomScore: null, winner: null, live: false, note: null, feeders: [], ...m };
}

export function hasTeam(m: BracketMatch, id: string): boolean {
  return m.top?.id === id || m.bottom?.id === id;
}

/** A knockout tree, drawn from its first round to the final. */
export interface Bracket {
  /** Round names, first round to final ("Wild Card" … "World Series"). */
  readonly rounds: readonly string[];
  readonly matches: Readonly<Record<string, BracketMatch>>;
  readonly finalID: string;
  /** Played outside the tree (a 3rd-place match). */
  readonly extra: readonly { readonly title: string; readonly match: BracketMatch }[];
}

export interface SwissRow {
  readonly team: BracketTeam;
  /** Per round: won, lost, or not played (yet). */
  readonly results: readonly (boolean | null)[];
  /** Per round: who they played (or play next, once drawn). */
  readonly opponents: readonly (BracketTeam | null)[];
}

export const swissWins = (r: SwissRow) => r.results.filter((x) => x === true).length;
export const swissLosses = (r: SwissRow) => r.results.filter((x) => x === false).length;

/** A Swiss stage: every team's result each round, toward a set number of wins. */
export interface SwissStage {
  readonly rounds: number;
  readonly rows: readonly SwissRow[];
  readonly winsToAdvance: number;
}

export interface TournamentBrackets {
  readonly title: string;
  readonly swiss: SwissStage | null;
  readonly bracket: Bracket | null;
}

// MARK: - MLB postseason (MLBPostseason)

/** One game, as much as the bracket needs. */
export interface PostseasonGame {
  /** "ALWC", "NLCS", "World Series" */
  readonly round: string;
  /** As listed. */
  readonly teams: readonly BracketTeam[];
  /** Series wins by team ID. */
  readonly wins: Readonly<Record<string, number>>;
  /** "MIL leads series 2-0" */
  readonly summary: string | null;
  /** The series. */
  readonly completed: boolean;
  readonly live: boolean;
  readonly date: string;
}

export const POSTSEASON_TYPE = (year: number) => `https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/seasons/${year}/types/3`;

/** "20261024" in New York (ESPN's days). */
export function easternDay(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** The postseason's days: its start to its end, or tomorrow if that's sooner. */
export function postseasonDays(start: number, end: number, now: number): string[] {
  const last = Math.min(end, now + 86_400_000);
  const days: string[] = [];
  for (let day = start; day <= last; day += 86_400_000) {
    const key = easternDay(day);
    if (!days.includes(key)) days.push(key);
  }
  return days;
}

/** Days that are over never change: kept for the session (only the last few are fetched again). */
const dayCache = new Map<string, PostseasonGame[]>();

export async function loadPostseason(path: string, year: number, fetcher: Fetcher, now = Date.now(), signal?: AbortSignal): Promise<TournamentBrackets> {
  const type = await fetcher(POSTSEASON_TYPE(year), { signal });
  const start = parseDate(str(at(type, "startDate")));
  if (start == null) throw new Error("No postseason dates");
  const end = parseDate(str(at(type, "endDate"))) ?? now;
  const days = postseasonDays(start, end, now);
  const recent = new Set(days.slice(-3));
  const all: PostseasonGame[] = [];
  let answered = 0;
  let firstFailure: unknown = null;
  // A few at a time: a polite burst, not thirty at once.
  for (let i = 0; i < days.length; i += 6) {
    const chunk = days.slice(i, i + 6);
    const settled = await Promise.allSettled(
      chunk.map(async (day) => {
        const cached = recent.has(day) ? undefined : dayCache.get(day);
        if (cached) return cached;
        const json = await fetcher(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}`, { signal });
        const games = arr(at(json, "events")).flatMap((e) => postseasonGame(e, day) ?? []);
        if (!recent.has(day)) dayCache.set(day, games);
        return games;
      }),
    );
    for (const r of settled) {
      if (r.status === "fulfilled") {
        answered++;
        all.push(...r.value);
      } else firstFailure ??= r.reason;
    }
  }
  // Not one day answered (offline, ESPN down): a failure to load, not an empty bracket ("No Bracket Yet").
  if (answered === 0 && firstFailure != null) throw firstFailure;
  all.sort((a, b) => a.date.localeCompare(b.date));
  return { title: `${year} Postseason`, swiss: null, bracket: postseasonBracket(all) };
}

export function postseasonGame(e: JSONValue, day: string): PostseasonGame | null {
  const c = at(e, "competitions", 0);
  const headline = str(at(c, "notes", 0, "headline"));
  if (!headline) return null;
  // "NLWC - Game 1" → "NLWC"; "World Series - Game 2" → "World Series".
  const round = headline.split(" - ")[0] ?? headline;
  const teams = arr(at(c, "competitors")).flatMap((comp): BracketTeam[] => {
    const t = at(comp, "team");
    const id = str(at(t, "id"));
    if (!id) return [];
    return [{ id, name: str(at(t, "shortDisplayName")) ?? str(at(t, "displayName")) ?? "", abbreviation: str(at(t, "abbreviation")) ?? "", logo: str(at(t, "logo")) ?? null }];
  });
  if (teams.length !== 2) return null;
  const wins: Record<string, number> = {};
  for (const s of arr(at(c, "series", "competitors"))) {
    const id = str(at(s, "id"));
    if (id) wins[id] = int(at(s, "wins")) ?? 0;
  }
  return {
    round,
    teams,
    wins,
    summary: str(at(c, "series", "summary")) ?? null,
    completed: bool(at(c, "series", "completed")) ?? false,
    live: str(at(e, "status", "type", "state")) === "in",
    date: day,
  };
}

/** "MIL leads series 2-1" → "MIL leads 2–1". */
export function shortSummary(summary: string): string {
  return summary.replaceAll(" series", "").replaceAll("-", "–");
}

/** Wild Card → Division Series → Championship Series in each league, then the World Series. */
export function postseasonBracket(games: readonly PostseasonGame[]): Bracket | null {
  if (games.length === 0) return null;
  // One matchup per series: the latest game has its standing.
  const series = new Map<string, BracketMatch>();
  const order: string[] = [];
  for (const game of games) {
    const [a, b] = game.teams as [BracketTeam, BracketTeam];
    const key = `${game.round}:${game.teams.map((t) => t.id).sort().join("-")}`;
    if (!series.has(key)) order.push(key);
    const topScore = game.wins[a.id] ?? null;
    const bottomScore = game.wins[b.id] ?? null;
    series.set(
      key,
      bracketMatch({
        id: key,
        top: a,
        bottom: b,
        topScore,
        bottomScore,
        winner: game.completed && topScore != null && bottomScore != null && topScore !== bottomScore ? (topScore > bottomScore ? "top" : "bottom") : null,
        live: game.live,
        note: game.summary ? shortSummary(game.summary) : null,
      }),
    );
  }
  const list = (round: string) => order.filter((k) => k.startsWith(`${round}:`)).flatMap((k) => series.get(k) ?? []);
  const winner = (m: BracketMatch) => (m.winner === "top" ? m.top : m.winner === "bottom" ? m.bottom : null);

  const matches: Record<string, BracketMatch> = {};
  const championships: string[] = [];
  for (const league of ["AL", "NL"]) {
    const wildCards = list(`${league}WC`);
    const divisions = list(`${league}DS`);
    const divisionIDs: string[] = [];
    // Each Division Series is fed by the Wild Card series its newcomer came from.
    wildCards.forEach((wc, index) => {
      const teams = [wc.top?.id, wc.bottom?.id].filter((t): t is string => t != null);
      const i = divisions.findIndex((ds) => teams.some((t) => hasTeam(ds, t)));
      if (i >= 0) {
        const ds = divisions.splice(i, 1)[0]!;
        matches[ds.id] = { ...ds, feeders: [wc.id] };
        divisionIDs.push(ds.id);
      } else {
        const placeholder = bracketMatch({ id: `${league}DS-${index}`, bottom: winner(wc), feeders: [wc.id] });
        matches[placeholder.id] = placeholder;
        divisionIDs.push(placeholder.id);
      }
      matches[wc.id] = wc;
    });
    for (const ds of divisions) {
      matches[ds.id] = ds;
      divisionIDs.push(ds.id);
    }
    const cs = list(`${league}CS`)[0] ?? bracketMatch({ id: `${league}CS` });
    matches[cs.id] = { ...cs, feeders: divisionIDs };
    championships.push(cs.id);
  }
  const final = list("World Series")[0] ?? bracketMatch({ id: "WS" });
  matches[final.id] = { ...final, feeders: championships };
  return { rounds: ["Wild Card", "Division Series", "Championship", "World Series"], matches, finalID: final.id, extra: [] };
}

// MARK: - CS2 tournaments (CSTournament)

const BO3 = "https://api.bo3.gg/api/v1";

/**
 * One page of a tournament's matches. bo3.gg caps `page[limit]` at 100
 * (asking for 200 silently returns 100), so long tournaments page.
 */
export function tournamentMatchesURL(id: number, offset: number): string {
  return `${BO3}/matches?filter%5Bmatches.tournament_id%5D%5Beq%5D=${id}&page%5Blimit%5D=100&page%5Boffset%5D=${offset}&with=teams`;
}

/** A Swiss stage is typed "swiss" (ESL Pro League) or "group" (IEM). */
export function isSwiss(format: string): boolean {
  return format === "swiss" || format === "group";
}

/** A bo3.gg tournament: its stages and its match list (teams, live state). About four requests. */
export async function loadTournament(slug: string, fetcher: Fetcher, now = Date.now(), signal?: AbortSignal): Promise<TournamentBrackets> {
  const tournament = await fetcher(`${BO3}/tournaments/${encodeURIComponent(slug)}`, { signal });
  const id = int(at(tournament, "id"));
  if (id == null) throw new Error("No tournament");
  const name = str(at(tournament, "name")) ?? slug;
  const stageInfo = arr(at(tournament, "stages")).flatMap((s): [number, string][] => {
    const sid = int(at(s, "id"));
    return sid == null ? [] : [[sid, str(at(s, "format_type")) ?? ""]];
  });
  const listCall = matchList(id, fetcher, signal);
  const settled = await Promise.allSettled(stageInfo.map(([sid]) => fetcher(`${BO3}/stages/${sid}`, { signal })));
  const stages: Record<number, JSONValue> = {};
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") stages[stageInfo[i]![0]] = r.value;
  });
  return buildTournament(name, stageInfo, stages, await listCall, now);
}

/** Every match of a tournament, a page of 100 at a time (a 32-team Major passes 100). */
export async function matchList(id: number, fetcher: Fetcher, signal?: AbortSignal): Promise<JSONValue[]> {
  const all: JSONValue[] = [];
  for (let offset = 0; offset < 1000; ) {
    const page = await fetcher(tournamentMatchesURL(id, offset), { signal });
    const results = arr(at(page, "results"));
    all.push(...results);
    offset += 100;
    if (results.length === 0 || offset >= (int(at(page, "total", "count")) ?? 0)) break;
  }
  return all;
}

/** The stages and the match list made into a Swiss table and a playoff tree (pure). */
export function buildTournament(
  name: string,
  stageInfo: readonly (readonly [number, string])[],
  stages: Readonly<Record<number, JSONValue>>,
  list: readonly JSONValue[],
  now: number,
): TournamentBrackets {
  // Teams and live state from the match list (stages only carry IDs).
  const teams = new Map<number, BracketTeam>();
  const live = new Set<number>();
  for (const m of list) {
    for (const key of ["team1", "team2"]) {
      const t = at(m, key);
      const tid = int(at(t, "id"));
      const tname = str(at(t, "name"));
      if (tid != null && tname) teams.set(tid, { id: String(tid), name: tname, abbreviation: abbreviate(tname), logo: str(at(t, "image_url")) ?? null });
    }
    const mid = int(at(m, "id"));
    if (str(at(m, "status")) === "current" && mid != null) live.add(mid);
  }

  let swiss: SwissStage | null = null;
  const playoffs: JSONValue[] = [];
  for (const [sid, format] of stageInfo) {
    const stage = stages[sid];
    if (stage == null) continue;
    if (isSwiss(format) && swiss == null) swiss = swissStage(stage, teams);
    else if (format === "playoff") playoffs.push(stage);
  }
  // The biggest playoff stage is the tree; one-match stages (3rd place) sit under it.
  const sorted = [...playoffs].sort((a, b) => matchCount(b) - matchCount(a));
  let bracket: Bracket | null = null;
  if (sorted[0] != null) {
    const main = tree(sorted[0], teams, live, now);
    if (main) {
      const extra = sorted.slice(1).flatMap((decider) =>
        arr(at(decider, "rounds")).flatMap((round) =>
          arr(at(round, "matches")).flatMap((m) => {
            const match = csMatch(m, teams, live, now);
            return match ? [{ title: str(at(round, "name")) ?? "Decider", match }] : [];
          }),
        ),
      );
      bracket = { ...main, extra };
    }
  }
  return { title: name, swiss, bracket };
}

function matchCount(stage: JSONValue): number {
  return arr(at(stage, "rounds")).reduce((n: number, r) => n + arr(at(r, "matches")).length, 0);
}

export function csMatch(m: JSONValue, teams: ReadonlyMap<number, BracketTeam>, live: ReadonlySet<number>, now: number): BracketMatch | null {
  const id = int(at(m, "id"));
  if (id == null) return null;
  const t1 = int(at(m, "team1_id"));
  const t2 = int(at(m, "team2_id"));
  const status = str(at(m, "status"));
  // Canceled and postponed matches weren't played: no score, no winner, say so.
  const called = status === "canceled" ? "Canceled" : status === "postponed" ? "Postponed" : null;
  const started = status !== "upcoming" && called == null;
  const w = int(at(m, "winner_team_id"));
  const winner: BracketSide | null = called == null && w != null ? (w === t1 ? "top" : w === t2 ? "bottom" : null) : null;
  const bo = int(at(m, "bo_type"));
  const start = parseDate(str(at(m, "start_date")));
  const date = start != null ? dayAndTime(start, now) : null;
  const note = [bo != null ? `Best of ${bo}` : null, called ?? (winner == null ? date : null)].filter(Boolean).join(" · ");
  return bracketMatch({
    id: String(id),
    top: t1 != null ? (teams.get(t1) ?? null) : null,
    bottom: t2 != null ? (teams.get(t2) ?? null) : null,
    topScore: started ? (int(at(m, "team1_score")) ?? null) : null,
    bottomScore: started ? (int(at(m, "team2_score")) ?? null) : null,
    winner,
    live: called == null && (live.has(id) || status === "current"),
    note: note || null,
  });
}

/**
 * Rounds in order; match positions are a depth-first numbering of the tree
 * (final 1, its first semi 2 with quarters 3 and 4, …).
 */
export function tree(stage: JSONValue, teams: ReadonlyMap<number, BracketTeam>, live: ReadonlySet<number>, now: number): Bracket | null {
  const rounds = [...arr(at(stage, "rounds"))].sort((a, b) => (int(at(a, "round_index")) ?? 0) - (int(at(b, "round_index")) ?? 0));
  if (rounds.length === 0) return null;
  const matches: Record<string, BracketMatch> = {};
  const depth = new Map<string, number>();
  const positions = new Map<string, number>();
  const byRound: string[][] = [];
  rounds.forEach((round, index) => {
    const ids: string[] = [];
    for (const m of arr(at(round, "matches"))) {
      const match = csMatch(m, teams, live, now);
      if (!match) continue;
      matches[match.id] = match;
      depth.set(match.id, rounds.length - 1 - index);
      const p = int(at(m, "position"));
      if (p != null) positions.set(match.id, p);
      ids.push(match.id);
    }
    byRound.push(ids);
  });
  const finalID = byRound[byRound.length - 1]?.[0];
  if (!finalID) return null;

  const setFeeders = (id: string, feeders: string[]) => {
    const m = matches[id];
    if (m) matches[id] = { ...m, feeders };
  };
  if (positions.size === Object.keys(matches).length) {
    // Depth-first: each match is followed by its upper feeder's subtree, then the lower's.
    const order = Object.keys(matches).sort((a, b) => positions.get(a)! - positions.get(b)!);
    let cursor = 0;
    const parse = (level: number): string | null => {
      const id = order[cursor];
      if (id == null || depth.get(id) !== level) return null;
      cursor += 1;
      if (level < rounds.length - 1) {
        const upper = parse(level + 1);
        const lower = parse(level + 1);
        setFeeders(id, [upper, lower].filter((x): x is string => x != null));
      }
      return id;
    };
    parse(0);
  } else {
    // No positions: pair matches in listed order.
    for (let r = 1; r < byRound.length; r++) {
      byRound[r]!.forEach((id, k) => setFeeders(id, byRound[r - 1]!.slice(2 * k, 2 * k + 2)));
    }
  }
  return { rounds: rounds.map((r) => str(at(r, "name")) ?? ""), matches, finalID, extra: [] };
}

/** Every team's result each round, from the stage's matches. */
export function swissStage(stage: JSONValue, teams: ReadonlyMap<number, BracketTeam>): SwissStage | null {
  const rounds = [...arr(at(stage, "rounds"))].sort((a, b) => (int(at(a, "round_index")) ?? 0) - (int(at(b, "round_index")) ?? 0));
  if (rounds.length === 0) return null;
  const results = new Map<number, (boolean | null)[]>();
  const opponents = new Map<number, (BracketTeam | null)[]>();
  const order: number[] = [];
  rounds.forEach((round, index) => {
    for (const m of arr(at(round, "matches"))) {
      for (const [key, other] of [
        ["team1_id", "team2_id"],
        ["team2_id", "team1_id"],
      ] as const) {
        const team = int(at(m, key));
        if (team == null) continue;
        if (!results.has(team)) order.push(team);
        const row = results.get(team) ?? Array<boolean | null>(rounds.length).fill(null);
        const w = int(at(m, "winner_team_id"));
        if (w != null) row[index] = w === team;
        results.set(team, row);
        const faced = opponents.get(team) ?? Array<BracketTeam | null>(rounds.length).fill(null);
        const o = int(at(m, other));
        faced[index] = o != null ? (teams.get(o) ?? null) : null;
        opponents.set(team, faced);
      }
    }
  });
  const rows = order.flatMap((id): SwissRow[] => {
    const team = teams.get(id);
    return team ? [{ team, results: results.get(id)!, opponents: opponents.get(id) ?? [] }] : [];
  });
  if (rows.length === 0) return null;
  return { rounds: rounds.length, rows, winsToAdvance: Math.floor((rounds.length + 1) / 2) };
}

/** Best record first: most wins, fewest losses, then by name. */
export function swissOrder(stage: SwissStage): SwissRow[] {
  return [...stage.rows].sort((a, b) => swissWins(b) - swissWins(a) || swissLosses(a) - swissLosses(b) || a.team.name.localeCompare(b.team.name));
}

/** "Through", "Out", or null while it's still open. */
export function swissOutcome(row: SwissRow, stage: SwissStage): "Through" | "Out" | null {
  return swissWins(row) >= stage.winsToAdvance ? "Through" : swissLosses(row) >= stage.winsToAdvance ? "Out" : null;
}

export function spokenSwissRow(row: SwissRow, stage: SwissStage, opponents: boolean): string {
  const parts = [`${row.team.name}, ${plural(swissWins(row), "win")}, ${plural(swissLosses(row), "loss")}`];
  const outcome = swissOutcome(row, stage);
  if (outcome) parts.push(outcome === "Through" ? "through" : "out");
  if (opponents) {
    row.results.forEach((result, i) => {
      const team = row.opponents[i];
      if (!team) return;
      parts.push(result === true ? `beat ${team.name}` : result === false ? `lost to ${team.name}` : `plays ${team.name} next`);
    });
  }
  return parts.join(", ");
}

// MARK: - Layout (BracketLayout, BracketView's sizes)

export const BRACKET = {
  cellHeight: 38,
  spacing: 10,
  gap: 12,
  header: 16,
  /** Widest a matchup gets: wider only spreads two short rows apart. */
  maxCell: 180,
  /** Narrowest a matchup gets: a crest, a four-letter code and a score. Below it the tree scrolls. */
  minCell: 96,
  /** From here a cell has room for "White Sox" or "Natus Vincere". */
  namesFrom: 120,
} as const;

export interface BracketSlot {
  readonly column: number;
  readonly center: number;
}

export interface BracketLayout {
  readonly slots: Readonly<Record<string, BracketSlot>>;
  readonly height: number;
}

/**
 * Where each matchup sits: columns by round, final at the right; first-round
 * matchups evenly spaced, every later one centered on the matchups feeding it.
 */
export function bracketLayout(bracket: Bracket): BracketLayout {
  const slots: Record<string, BracketSlot> = {};
  let nextLeaf = 0;
  const step = BRACKET.cellHeight + BRACKET.spacing;
  const place = (id: string, column: number): number => {
    const feeders = bracket.matches[id]?.feeders ?? [];
    let center: number;
    if (feeders.length === 0 || column === 0) {
      center = nextLeaf * step + BRACKET.cellHeight / 2;
      nextLeaf += 1;
    } else {
      const centers = feeders.map((f) => place(f, column - 1));
      center = (centers[0]! + centers[centers.length - 1]!) / 2;
    }
    slots[id] = { column, center };
    return center;
  };
  place(bracket.finalID, bracket.rounds.length - 1);
  return { slots, height: Math.max(nextLeaf * step - BRACKET.spacing, BRACKET.cellHeight) };
}

/** Each round's column width in `width` points of room. */
export function cellWidth(width: number, rounds: number): number {
  const n = Math.max(rounds, 1);
  return Math.min((width - BRACKET.gap * (n - 1)) / n, BRACKET.maxCell);
}

export function treeWidth(cell: number, rounds: number): number {
  const n = Math.max(rounds, 1);
  return cell * n + BRACKET.gap * (n - 1);
}

/** The tree at its widest. */
export function maxTreeWidth(rounds: number): number {
  return treeWidth(BRACKET.maxCell, rounds);
}

/**
 * The round a scrolled tree opens on: the one being played (a live matchup,
 * else a series under way between games), else the latest with a result,
 * else the first. The Mac's rule, plus the series between games: a World
 * Series at 3–0 on an off day is still the round being played.
 */
export function focusColumn(bracket: Bracket, layout: BracketLayout): number {
  const matches = Object.values(bracket.matches);
  const columns = (pick: (m: BracketMatch) => boolean) => matches.filter(pick).flatMap((m) => (layout.slots[m.id] ? [layout.slots[m.id]!.column] : []));
  const live = columns((m) => m.live);
  const underway = columns((m) => m.winner == null && (m.topScore ?? 0) + (m.bottomScore ?? 0) > 0);
  const decided = columns((m) => m.winner != null);
  return live.length ? Math.max(...live) : underway.length ? Math.max(...underway) : decided.length ? Math.max(...decided) : 0;
}

/** Matchups in reading order: round by round, top to bottom. */
export function readingOrder(layout: BracketLayout): string[] {
  return Object.entries(layout.slots)
    .sort(([, a], [, b]) => a.column - b.column || a.center - b.center)
    .map(([id]) => id);
}

/** A matchup between the teams of the match the page was opened from. */
export function isRinged(match: BracketMatch, ring: ReadonlySet<string>): boolean {
  if (ring.size === 0) return false;
  const hits = [match.top?.id, match.bottom?.id].filter((id): id is string => id != null && ring.has(id)).length;
  return hits === Math.min(2, ring.size);
}

/** The ring's IDs as bracket teams carry them: "espn-baseball-10" → "10", "cs-793" → "793". */
export function ringIDs(raw: readonly string[]): Set<string> {
  return new Set(raw.map((id) => id.split("-").pop() ?? id).filter(Boolean));
}

/**
 * "Quarterfinals: Yankees 3, Guardians 1. Yankees won." / "…, Live." /
 * "Semifinals: to be decided."
 */
export function spokenMatch(match: BracketMatch, round: string): string {
  const prefix = round ? `${round}: ` : "";
  const { top, bottom } = match;
  if (!top || !bottom) {
    const known = [top?.name, bottom?.name].filter((n): n is string => n != null);
    return prefix + (known.length === 0 ? "to be decided." : `${known[0]} versus to be decided.`);
  }
  let line = prefix;
  if (match.topScore != null && match.bottomScore != null) line += `${top.name} ${match.topScore}, ${bottom.name} ${match.bottomScore}.`;
  else line += `${top.name} versus ${bottom.name}.`;
  if (match.winner) line += ` ${(match.winner === "top" ? top : bottom).name} won.`;
  else if (match.live) line += " Live.";
  if (match.note) line += ` ${match.note}.`;
  return line;
}

/** The pointed-at matchup's readout: the score (or the names) and the rest. */
export function readout(match: BracketMatch): { lead: string; detail: string } {
  const names = `${match.top?.name ?? "TBD"} v ${match.bottom?.name ?? "TBD"}`;
  const score = match.topScore != null && match.bottomScore != null ? `${match.topScore}–${match.bottomScore}` : null;
  return { lead: score ?? names, detail: [score == null ? null : names, match.note].filter(Boolean).join(" · ") };
}

export function spokenBracket(bracket: Bracket): string {
  const final = bracket.matches[bracket.finalID];
  const teams = [final?.top?.name, final?.bottom?.name].filter(Boolean);
  return `Bracket, ${plural(bracket.rounds.length, "round")}. Final: ${teams.length === 0 ? "to be decided" : teams.join(" versus ")}`;
}
