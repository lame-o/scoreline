/**
 * A soccer competition's season from ESPN (SoccerCompetition.swift): its rounds,
 * their ties and the tree they make. The rounds come from ESPN's season metadata,
 * never a format written down here, and the tree is worked out once from what's
 * actually drawn: a round nobody has drawn stays undrawn, and a season with no
 * clean run to its final has no tree at all.
 */
import { arr, at, bool, int, str, type JSONValue } from "./json";
import type { Fetcher } from "./http";
import { bracketMatch, hasTeam, type Bracket, type BracketMatch, type BracketTeam } from "./brackets";
import { compareDays, dayKeyFromISO, dayKeyOf, type DayKey } from "./days";
import { leagueWithID } from "./leagues";
import { scheduleEvent } from "./providers/schedule";
import { sortDate, type ScheduleItem } from "./schedule";

const integer = (v: JSONValue): number | null => int(v) ?? (typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);
const key = (v: JSONValue): string | undefined => str(v) ?? int(v)?.toString();

// MARK: - What ESPN publishes

/** A competition as its scoreboard describes it. */
export interface CompetitionInfo {
  /** "Carabao Cup" */
  readonly name: string | null;
  readonly logo: string | null;
  readonly darkLogo: string | null;
  readonly year: number | null;
}

export function parseCompetitionInfo(json: JSONValue): CompetitionInfo {
  const league = at(json, "leagues", 0);
  const logos = arr(at(league, "logos"));
  const dark = (l: JSONValue) => arr(at(l, "rel")).some((r) => str(r) === "dark");
  return {
    name: str(at(league, "abbreviation")) ?? str(at(league, "name")) ?? null,
    logo: str(at(logos.find((l) => !dark(l)), "href")) ?? null,
    darkLogo: str(at(logos.find(dark), "href")) ?? null,
    year: int(at(league, "season", "year")) ?? null,
  };
}

interface SeasonStage {
  readonly id: string;
  readonly name: string;
  readonly hasLegs: boolean;
  readonly hasStandings: boolean;
  readonly isFinal: boolean;
  readonly isThirdPlace: boolean;
  readonly start: DayKey | null;
  readonly end: DayKey | null;
}

/** A season's stages, as ESPN's core API lists them. */
export interface CompetitionSeason {
  readonly year: number;
  /** "2026-27 English Carabao Cup" */
  readonly displayName: string;
  readonly current: string | null;
  readonly stages: readonly SeasonStage[];
}

export function parseCompetitionSeason(json: JSONValue): CompetitionSeason | null {
  const year = int(at(json, "year"));
  if (year == null) return null;
  const stages = arr(at(json, "types", "items")).flatMap((item): SeasonStage[] => {
    const id = key(at(item, "type")), name = str(at(item, "name"));
    if (!id || !name) return [];
    return [{
      id, name: name.trim(),
      hasLegs: bool(at(item, "hasLegs")) === true,
      hasStandings: bool(at(item, "hasStandings")) === true || bool(at(item, "hasGroups")) === true,
      isFinal: bool(at(item, "isFinal")) === true,
      isThirdPlace: bool(at(item, "isThirdPlace")) === true,
      start: dayKeyFromISO(str(at(item, "startDate"))),
      end: dayKeyFromISO(str(at(item, "endDate"))),
    }];
  });
  if (stages.length === 0) return null;
  return { year, displayName: str(at(json, "displayName")) ?? "", current: key(at(json, "type", "type")) ?? null, stages };
}

/** A tie's running state, on each of its games. */
interface GameSeries {
  readonly completed: boolean;
  /** ESPN's flag: usually the tie's winner, sometimes only the last leg's (Libertadores 2026). */
  readonly winner: string | null;
  /** Each team's total over the legs, once ESPN has one. */
  readonly aggregate: Readonly<Record<string, number>>;
  /** How many games it can run to. */
  readonly total: number | null;
}

/** One game on a competition's board, with what the tree needs to know about it. */
export interface CompetitionGame {
  readonly item: ScheduleItem;
  readonly stage: string;
  readonly year: number;
  /** Null for a placeholder ("TBD Away", "Winner Match 73"). */
  readonly home: BracketTeam | null;
  readonly away: BracketTeam | null;
  readonly goals: Readonly<Record<string, number>>;
  /** ESPN's winner: on penalties too, where the goals are level. */
  readonly winner: string | null;
  readonly series: GameSeries | null;
}

/** ESPN names a side it doesn't know yet instead of leaving it out. */
export function isPlaceholder(name: string): boolean {
  return /^TBD\b|\b(Winner|Loser)\b/.test(name);
}

export function parseCompetitionBoard(json: JSONValue, slug: string, now = Date.now()): CompetitionGame[] {
  return arr(at(json, "events")).flatMap((event): CompetitionGame[] => {
    const year = int(at(event, "season", "year")), stage = key(at(event, "season", "type"));
    if (year == null || !stage) return [];
    const item = scheduleEvent(event, `soccer/${slug}`, slug, "soccer", null, now);
    if (!item) return [];
    const c = at(event, "competitions", 0), competitors = arr(at(c, "competitors"));
    const team = (side: string): BracketTeam | null => {
      const t = at(competitors.find((x) => str(at(x, "homeAway")) === side), "team");
      const id = key(at(t, "id"));
      if (!id || isPlaceholder(str(at(t, "displayName")) ?? "")) return null;
      return { id, name: str(at(t, "shortDisplayName")) ?? str(at(t, "displayName")) ?? "", abbreviation: str(at(t, "abbreviation")) ?? "", logo: str(at(t, "logo")) ?? null };
    };
    const goals: Record<string, number> = {};
    for (const competitor of competitors) {
      const id = key(at(competitor, "team", "id")), score = integer(at(competitor, "score"));
      if (id && score != null) goals[id] = score;
    }
    const series = at(c, "series");
    const entries = arr(at(series, "competitors"));
    const aggregate: Record<string, number> = {};
    for (const entry of entries) {
      const id = key(at(entry, "id")), total = integer(at(entry, "aggregateScore"));
      if (id && total != null) aggregate[id] = total;
    }
    return [{
      item, stage, year, home: team("home"), away: team("away"), goals,
      winner: key(at(competitors.find((x) => bool(at(x, "winner")) === true), "team", "id")) ?? null,
      series: series == null ? null : {
        completed: bool(at(series, "completed")) === true,
        winner: key(at(entries.find((x) => bool(at(x, "winner")) === true), "id")) ?? null,
        aggregate,
        total: int(at(series, "totalCompetitions")) ?? null,
      },
    }];
  });
}

// MARK: - The season

export interface CompetitionTie { readonly id: string; readonly match: BracketMatch; readonly games: readonly ScheduleItem[] }

/** A round or phase. ESPN's conference playoffs read as one round here, and what isn't part of the competition (an All-Star game) doesn't appear. */
export interface CompetitionStage {
  readonly id: string;
  readonly name: string;
  readonly hasStandings: boolean;
  readonly isFinal: boolean;
  readonly isThirdPlace: boolean;
  readonly start: DayKey | null;
  readonly games: readonly ScheduleItem[];
  /** Knockout rounds: each pair of teams, however many games they play. */
  readonly ties: readonly CompetitionTie[];
}

export interface SoccerCompetition {
  readonly slug: string;
  readonly title: string;
  readonly year: number;
  /** "2026–27", "2026" */
  readonly seasonLabel: string;
  readonly logo: string | null;
  readonly darkLogo: string | null;
  readonly currentStage: string | null;
  readonly stages: readonly CompetitionStage[];
  /** The run to the final, when there's a clean one with something drawn in it. */
  readonly bracket: Bracket | null;
  /** Where the tree will start, while nothing in it is drawn ("Round of 16"). */
  readonly undrawnFrom: string | null;
}

export function competitionPath(slug: string, year?: number | null, ring: readonly (string | null)[] = []): string {
  const teams = ring.filter((id): id is string => id != null);
  return `/competition/${encodeURIComponent(slug)}${year == null ? "" : `/${year}`}${teams.length ? `?ring=${teams.map(encodeURIComponent).join(",")}` : ""}`;
}

/** "2026-27 English Carabao Cup" → "Carabao Cup", for a competition ESPN gives no short name. */
export function competitionTitle(displayName: string): string {
  return displayName.replace(/^\d{4}(-\d{2,4})?\s+/, "").replace(/^(English|Spanish|German|Italian|French|Dutch|Scottish|Portuguese) /, "");
}

/** "2026-27 English Carabao Cup" → "2026–27"; "2026 MLS" → "2026". */
export function seasonLabel(displayName: string, year: number): string {
  const match = /^\d{4}-\d{2}\b/.exec(displayName);
  return match ? match[0].replace("-", "–") : String(year);
}

/** ESPN splits MLS's playoffs by conference, then by series: the same round for this page. */
export function roundName(name: string): string {
  const match = /^(?:Eastern|Western) Conference Playoffs - (.+)$/.exec(name);
  if (!match) return name;
  return match[1] === "Semifinals" ? "Conference Semifinals" : match[1] === "Final" ? "Conference Finals" : match[1]!;
}

const isExhibition = (name: string) => /all-star/i.test(name) || name === "Combined";

/** A pair of teams' games as one tie: goals when it's one game, the aggregate over two legs, games won over a series. The aggregate names the winner whenever it can: ESPN's flag sometimes follows the last leg instead. */
function makeTie(id: string, games: readonly CompetitionGame[], legs: boolean): CompetitionTie {
  const first = games[0]!;
  const played = games.filter((g) => g.item.status === "live" || g.item.status === "final");
  const series = [...games].reverse().find((g) => g.series != null)?.series ?? null;
  const bestOf = !legs && (series?.total ?? 0) > 2;
  const score = (team: BracketTeam | null): number | null => {
    if (!team || played.length === 0) return null;
    if (legs) return series?.aggregate[team.id] ?? played.reduce((sum, g) => sum + (g.goals[team.id] ?? 0), 0);
    if (bestOf) return played.filter((g) => g.winner === team.id).length;
    return played.at(-1)?.goals[team.id] ?? null;
  };
  const topScore = score(first.home), bottomScore = score(first.away);
  let winner: string | null;
  if (legs || bestOf) {
    if (series?.completed !== true || topScore == null || bottomScore == null) winner = null;
    else winner = topScore !== bottomScore ? (topScore > bottomScore ? first.home?.id : first.away?.id) ?? null : series.winner;
  } else {
    winner = [...played].reverse().find((g) => g.item.status === "final")?.winner ?? null;
  }
  const last = played.at(-1)?.item;
  return {
    id,
    games: games.map((g) => g.item),
    match: bracketMatch({
      id, top: first.home, bottom: first.away, topScore, bottomScore,
      live: games.some((g) => g.item.status === "live"),
      note: last?.notes.at(-1) ?? last?.statusDetail ?? null,
      winner: winner == null ? null : winner === first.home?.id ? "top" : winner === first.away?.id ? "bottom" : null,
    }),
  };
}

function buildStages(season: CompetitionSeason, games: readonly CompetitionGame[], competition: string, today: DayKey): CompetitionStage[] {
  // Same-named stages are one round, where its first one falls.
  const merged = new Map<string, SeasonStage[]>();
  for (const stage of season.stages) {
    if (isExhibition(stage.name)) continue;
    const name = roundName(stage.name);
    merged.set(name, [...(merged.get(name) ?? []), stage]);
  }
  return [...merged.entries()].flatMap(([name, parts]): CompetitionStage[] => {
    const ids = new Set(parts.map((p) => p.id));
    const own = games.filter((g) => ids.has(g.stage));
    // A window that's over with nothing in it never happened (MLS's "Combined").
    const end = parts.flatMap((p) => (p.end ? [p.end] : [])).sort(compareDays).at(-1);
    if (own.length === 0 && end && compareDays(end, today) < 0) return [];
    const title = /^\d{4}/.test(name) ? "Season" : name;
    const round = title === "Season" ? competition : `${competition} · ${title}`;
    const named = own.map((g) => ({ ...g, item: { ...g.item, competition: round } }));
    const hasStandings = parts.some((p) => p.hasStandings);
    const groups = new Map<string, CompetitionGame[]>();
    if (!hasStandings) {
      for (const game of named) {
        // A placeholder pairs with nobody: its own tie until the side is known.
        const pair = game.home && game.away ? [game.home.id, game.away.id].sort().join(":") : game.item.id;
        groups.set(pair, [...(groups.get(pair) ?? []), game]);
      }
    }
    const legs = parts.some((p) => p.hasLegs);
    return [{
      id: parts[0]!.id, name: title, hasStandings,
      isFinal: parts.some((p) => p.isFinal), isThirdPlace: parts.some((p) => p.isThirdPlace),
      start: parts.flatMap((p) => (p.start ? [p.start] : [])).sort(compareDays)[0] ?? null,
      games: named.map((g) => g.item),
      ties: [...groups.entries()].map(([pair, list]) => makeTie(`${parts[0]!.id}:${pair}`, list, legs)),
    }];
  });
}

/** A tree's widest round, after which earlier rounds stay in Fixtures: the last 16. */
const TREE_ENTRY = 8;

const tieTeams = (stage: CompetitionStage) => new Set(stage.ties.flatMap((t) => [t.match.top?.id, t.match.bottom?.id]).filter((id): id is string => id != null));

/** The run into a final: rounds halving exactly back from it, connected team by team, as far as the last 16. A knockout phase that opens wider right after a group stage (a World Cup's Round of 32) is all one tree. A round not drawn yet stays in the run only after the last one that is. */
function run(index: number, stages: readonly CompetitionStage[]): CompetitionStage[] {
  const rounds = [stages[index]!];
  let expected = 2;
  let position = index - 1;
  while (position >= 0) {
    const stage = stages[position]!;
    position -= 1;
    if (stage.isThirdPlace) continue;
    if (stage.hasStandings) break;
    if (expected > TREE_ENTRY) {
      const opensAfterGroups = position < 0 || stages[position]!.hasStandings;
      if (expected !== TREE_ENTRY * 2 || stage.ties.length !== expected || !opensAfterGroups) break;
    }
    const later = rounds[0]!;
    if (stage.ties.length === 0) {
      if (later.ties.length > 0) break;
    } else {
      const here = tieTeams(stage);
      if (stage.ties.length !== expected || ![...tieTeams(later)].every((id) => here.has(id))) break;
    }
    rounds.unshift(stage);
    expected *= 2;
  }
  return rounds;
}

/** The season's tree: the latest final with something drawn in its run. */
export function competitionTree(stages: readonly CompetitionStage[]): { bracket: Bracket | null; undrawnFrom: string | null } {
  const runs = stages.flatMap((s, i) => (s.isFinal && s.ties.length <= 1 ? [run(i, stages)] : [])).filter((r) => r.length > 1);
  const chosen = [...runs].reverse().find((r) => r.some((s) => s.ties.length > 0));
  if (!chosen) return { bracket: null, undrawnFrom: runs[0]?.[0]?.name ?? null };
  const matches: Record<string, BracketMatch> = {};
  const columns: string[][] = [];
  chosen.forEach((round, index) => {
    const next = index + 1 < chosen.length ? tieTeams(chosen[index + 1]!) : new Set<string>();
    const column: string[] = [];
    for (const tie of round.ties) {
      let match = tie.match;
      if (index > 0) {
        const feeders = [match.top, match.bottom].flatMap((team) => {
          const feeder = team ? chosen[index - 1]!.ties.find((t) => hasTeam(t.match, team.id)) : undefined;
          return feeder ? [feeder.id] : [];
        });
        match = { ...match, feeders };
      }
      // Who's in the next round settles it, whatever the flags said.
      const top = match.top != null && next.has(match.top.id), bottom = match.bottom != null && next.has(match.bottom.id);
      if (top !== bottom) match = { ...match, winner: top ? "top" : "bottom" };
      matches[match.id] = match;
      column.push(match.id);
    }
    const places = Math.max(2 ** (chosen.length - 1 - index), round.ties.length);
    for (let slot = round.ties.length; slot < places; slot++) {
      const id = `pending:${round.id}:${slot}`;
      matches[id] = bracketMatch({ id, pending: true });
      column.push(id);
    }
    columns.push(column);
  });
  const finalID = columns.at(-1)?.[0];
  if (!finalID) return { bracket: null, undrawnFrom: null };
  const extra = stages.filter((s) => s.isThirdPlace).flatMap((s) => s.ties.map((t) => ({ title: s.name, match: t.match })));
  return { bracket: { rounds: chosen.map((s) => s.name), matches, finalID, columns, extra }, undrawnFrom: null };
}

export function buildCompetition(slug: string, info: CompetitionInfo, season: CompetitionSeason, games: readonly CompetitionGame[], today: DayKey = dayKeyOf(Date.now())): SoccerCompetition {
  const seen = new Set<string>();
  const own = games.filter((g) => {
    if (g.year !== season.year || seen.has(g.item.id)) return false;
    seen.add(g.item.id);
    return true;
  }).sort((a, b) => sortDate(a.item) - sortDate(b.item));
  const title = leagueWithID(slug)?.name ?? info.name ?? competitionTitle(season.displayName);
  const stages = buildStages(season, own, title, today);
  const current = season.stages.find((s) => s.id === season.current);
  const currentName = current ? roundName(current.name) : null;
  return {
    slug, title, year: season.year, seasonLabel: seasonLabel(season.displayName, season.year),
    logo: info.logo, darkLogo: info.darkLogo,
    currentStage: stages.find((s) => s.name === currentName)?.id ?? null,
    stages, ...competitionTree(stages),
  };
}

// MARK: - Loading

/** A busy competition's calendar year can pass this: it's then read month by month. */
const BOARD_LIMIT = 1000;

async function readBoard(base: string, slug: string, dates: string, fetcher: Fetcher, signal?: AbortSignal): Promise<CompetitionGame[]> {
  const board = await fetcher(`${base}?dates=${dates}&limit=${BOARD_LIMIT}`, { signal });
  if (arr(at(board, "events")).length < BOARD_LIMIT) return parseCompetitionBoard(board, slug);
  // Never silently a truncated season.
  if (dates.length !== 4) throw new Error("Competition response is incomplete");
  const months = await Promise.all(Array.from({ length: 12 }, (_, i) => readBoard(base, slug, `${dates}${String(i + 1).padStart(2, "0")}`, fetcher, signal)));
  return months.flat();
}

async function loadSeason(slug: string, year: number, info: CompetitionInfo, base: string, fetcher: Fetcher, signal?: AbortSignal): Promise<SoccerCompetition> {
  const season = parseCompetitionSeason(await fetcher(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}/seasons/${year}`, { signal }));
  if (!season) throw new Error("Competition rounds unavailable");
  // A European season spans two calendar years; ESPN's window says which.
  const end = season.stages.flatMap((s) => (s.end ? [s.end.year] : [])).reduce((a, b) => Math.max(a, b), year);
  if (end < year || end > year + 1) throw new Error("Invalid competition season");
  const games: CompetitionGame[] = [];
  for (let y = year; y <= end; y++) games.push(...await readBoard(base, slug, String(y), fetcher, signal));
  return buildCompetition(slug, info, season, games);
}

/** A competition's season. With none asked for, the current one, or the one just finished while ESPN's next has nothing in it yet. */
export async function loadSoccerCompetition(slug: string, requested: number | null, fetcher: Fetcher, signal?: AbortSignal): Promise<SoccerCompetition> {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
  const info = parseCompetitionInfo(await fetcher(base, { signal }));
  const year = requested ?? info.year;
  if (!year) throw new Error("Competition season unavailable");
  const competition = await loadSeason(slug, year, info, base, fetcher, signal);
  const empty = (c: SoccerCompetition) => c.stages.every((s) => s.games.length === 0);
  if (requested == null && empty(competition)) {
    const previous = await loadSeason(slug, year - 1, info, base, fetcher, signal).catch(() => null);
    if (previous && !empty(previous)) return previous;
  }
  return competition;
}

// MARK: - A match's competition

/** The competition a match belongs to, from its summary: wherever the match was opened from, this is what it was played in. */
export interface MatchCompetition {
  /** "uefa.champions" */
  readonly slug: string;
  /** "UEFA Champions League" */
  readonly name: string;
  /** The season the match was played in. */
  readonly year: number | null;
  /** "League Phase", "Fourth Round"; null for a season with no rounds. */
  readonly stage: string | null;
  /** ESPN's note on the match: "Liverpool win 6-5 on penalties", "1st Leg". */
  readonly note: string | null;
}

export function parseMatchCompetition(summary: JSONValue): MatchCompetition | null {
  const slug = str(at(summary, "header", "league", "slug"));
  if (!slug) return null;
  const season = str(at(summary, "header", "season", "name"));
  const note = str(at(summary, "header", "competitions", 0, "notes", 0, "headline"));
  return {
    slug,
    name: leagueWithID(slug)?.name ?? str(at(summary, "header", "league", "abbreviation")) ?? str(at(summary, "header", "league", "name")) ?? slug,
    year: int(at(summary, "header", "season", "year")) ?? null,
    stage: season?.split(", ").slice(1).at(-1) ?? null,
    note: note ? note.replace(/ - /g, " · ") : null,
  };
}

/** Whether it has a path through rounds to show: a cup or tournament, or a league's own playoffs. */
export function hasKnockoutRounds(competition: MatchCompetition): boolean {
  const kind = leagueWithID(competition.slug)?.kind;
  if (kind != null && kind !== "league") return true;
  return competition.stage != null && !/Regular Season|League Phase|Group|Torneo/.test(competition.stage);
}

/** The hero's line: "Carabao Cup · Fourth Round". */
export function competitionLine(competition: MatchCompetition): string {
  return [competition.name, competition.stage === "Regular Season" ? null : competition.stage].filter(Boolean).join(" · ");
}
