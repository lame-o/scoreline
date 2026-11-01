import { arr, at, bool, int, str, type JSONValue } from "./json";
import type { Fetcher } from "./http";
import { bracketMatch, type Bracket, type BracketMatch, type BracketTeam } from "./brackets";
import { scheduleEvent } from "./providers/schedule";
import type { ScheduleItem } from "./schedule";

const integer = (v: JSONValue): number | null => int(v) ?? (typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);
const key = (v: JSONValue): string | undefined => str(v) ?? int(v)?.toString();

export interface CompetitionTie { readonly id: string; readonly match: BracketMatch; readonly games: readonly ScheduleItem[] }
export interface CompetitionStage {
  readonly id: string; readonly name: string; readonly slug: string;
  readonly hasLegs: boolean; readonly hasStandings: boolean; readonly final: boolean; readonly thirdPlace: boolean;
  readonly ties: readonly CompetitionTie[];
}
export interface SoccerCompetition {
  readonly title: string; readonly year: number; readonly currentStage: string | null;
  readonly stages: readonly CompetitionStage[]; readonly bracket: Bracket | null;
}

export function competitionPath(slug: string, year?: number | null): string {
  return `/competition/${encodeURIComponent(slug)}${year == null ? "" : `/${year}`}`;
}

/** Only actual advancing teams establish feeder connections; future draws stay unknown. */
export function competitionBracket(stages: readonly CompetitionStage[]): Bracket | null {
  const knockout = stages.filter((s) => !s.hasStandings && !s.thirdPlace);
  const first = knockout.findIndex((s) => s.ties.length > 0);
  const rounds = first < 0 ? [] : knockout.slice(first);
  const last = rounds.at(-1);
  if (!last?.final || last.ties.length !== 1) return null;
  const matches: Record<string, BracketMatch> = {};
  rounds.forEach((stage, i) => {
    stage.ties.forEach(({ match }) => {
      const feeders = [match.top?.id, match.bottom?.id].flatMap((team) => {
        if (!team || i === 0) return [];
        const candidates = rounds[i - 1]!.ties.filter(({ match: m }) => (m.winner === "top" ? m.top?.id : m.winner === "bottom" ? m.bottom?.id : null) === team);
        return candidates.length === 1 ? [candidates[0]!.id] : [];
      });
      matches[match.id] = { ...match, feeders };
    });
  });
  const finalID = last.ties[0]!.id;
  return matches[finalID]!.feeders.length ? { rounds: rounds.map((s) => s.name), matches, finalID, extra: [] } : null;
}

/** Swift SoccerCompetitionProvider.parse, over the same recorded responses. */
export function parseSoccerCompetition(season: JSONValue, boards: readonly JSONValue[], slug: string): SoccerCompetition {
  const year = int(at(season, "year")) ?? 0;
  const seen = new Set<string>();
  const events = boards.flatMap((b) => arr(at(b, "events"))).filter((e) => {
    const id = str(at(e, "id"));
    if (!id || int(at(e, "season", "year")) !== year || seen.has(id)) return false;
    seen.add(id); return true;
  }).sort((a, b) => (str(at(a, "date")) ?? "").localeCompare(str(at(b, "date")) ?? ""));
  const stages: CompetitionStage[] = arr(at(season, "types", "items")).flatMap((s) => {
    const id = key(at(s, "type")), name = str(at(s, "name"));
    if (!id || !name) return [];
    const hasLegs = bool(at(s, "hasLegs")) === true;
    const ties = new Map<string, CompetitionTie>();
    for (const event of events.filter((e) => key(at(e, "season", "type")) === id)) {
      const parsed = scheduleEvent(event, `soccer/${slug}`, slug, "soccer", null, Date.now());
      if (!parsed) continue;
      const item = { ...parsed, competition: name };
      const c = at(event, "competitions", 0), competitors = arr(at(c, "competitors"));
      const team = (side: string): BracketTeam | null => {
        const t = at(competitors.find((x) => str(at(x, "homeAway")) === side), "team");
        const teamID = str(at(t, "id"));
        return teamID ? { id: teamID, name: str(at(t, "shortDisplayName")) ?? str(at(t, "displayName")) ?? "",
          abbreviation: str(at(t, "abbreviation")) ?? "", logo: str(at(t, "logo")) ?? null } : null;
      };
      const home = team("home"), away = team("away");
      if (!home || !away) continue;
      const key = hasLegs ? `${id}:${[home.id, away.id].sort().join(":")}` : item.id;
      const previous = ties.get(key) ?? { id: key, match: bracketMatch({ id: key, top: home, bottom: away }), games: [] };
      const games = [...previous.games, item];
      const scores = hasLegs ? arr(at(c, "series", "competitors")) : competitors;
      const done = hasLegs ? bool(at(c, "series", "completed")) === true : item.status === "final";
      const winningID = done ? str(at(scores.find((x) => bool(at(x, "winner")) === true), "id")) : undefined;
      const score = (teamID: string | undefined) => integer(at(scores.find((x) => str(at(x, "id")) === teamID), hasLegs ? "aggregateScore" : "score"));
      const note = arr(at(c, "notes")).map((n) => str(at(n, "headline")) ?? str(at(n, "text"))).filter(Boolean).join(" · ");
      ties.set(key, { id: key, games, match: { ...previous.match,
        live: games.some((g) => g.status === "live"), note: note || item.statusDetail,
        winner: !winningID ? null : winningID === previous.match.top?.id ? "top" : winningID === previous.match.bottom?.id ? "bottom" : null,
        topScore: score(previous.match.top?.id), bottomScore: score(previous.match.bottom?.id) } });
    }
    return [{ id, name, slug: str(at(s, "slug")) ?? id, hasLegs,
      hasStandings: bool(at(s, "hasStandings")) === true || bool(at(s, "hasGroups")) === true,
      final: bool(at(s, "isFinal")) === true, thirdPlace: bool(at(s, "isThirdPlace")) === true, ties: [...ties.values()] }];
  });
  return { title: str(at(season, "displayName")) ?? slug, year, currentStage: key(at(season, "type", "type")) ?? null,
    stages, bracket: competitionBracket(stages) };
}

export async function loadSoccerCompetition(slug: string, requested: number | null, fetcher: Fetcher, signal?: AbortSignal): Promise<SoccerCompetition> {
  const base = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
  const year = requested ?? int(at(await fetcher(base, { signal }), "leagues", 0, "season", "year"));
  if (!year) throw new Error("Competition season unavailable");
  const season = await fetcher(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${slug}/seasons/${year}`, { signal });
  if (!arr(at(season, "types", "items")).length) throw new Error("Competition rounds unavailable");
  const endYear = Number(str(at(season, "endDate"))?.slice(0, 4) ?? year);
  if (!Number.isInteger(endYear) || endYear < year || endYear > year + 1) throw new Error("Invalid competition season");
  const boards: JSONValue[] = [];
  for (let y = year; y <= endYear; y++) {
    const board = await fetcher(`${base}?dates=${y}&limit=1000`, { signal });
    if (arr(at(board, "events")).length >= 1000) {
      for (let month = 1; month <= 12; month++) {
        const monthBoard = await fetcher(`${base}?dates=${y}${String(month).padStart(2, "0")}&limit=1000`, { signal });
        if (arr(at(monthBoard, "events")).length >= 1000) throw new Error("Competition response is incomplete");
        boards.push(monthBoard);
      }
    } else boards.push(board);
  }
  return parseSoccerCompetition(season, boards, slug);
}
