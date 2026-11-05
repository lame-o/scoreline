/**
 * Sports' one search across competitions, tournaments and teams
 * (SportsView.swift `SportsSearch`, `SportsDirectory.indexed`), and a
 * sport's lists (`SportPage`): its leagues, cups, tournaments and circuit,
 * and the leagues whose teams it lists. Pure and tested.
 */
import { CATALOG } from "./leagues";
import { SPORT_NAME, type League, type Sport } from "./models";
import type { TeamOption } from "./providers/teams";
import type { SeasonEvent } from "./schedule";

/** The leagues whose teams make up the search: a cup's teams are a league's (and climbing has none). */
export function indexedLeagues(catalog: readonly League[] = CATALOG): League[] {
  return catalog.filter((l) => l.source.kind !== "ifsc" && l.kind !== "cup" && l.kind !== "tournament");
}

/** A sport's leagues of a kind, in the catalog's order. */
export function sportLeagues(sport: Sport, kind?: League["kind"], catalog: readonly League[] = CATALOG): League[] {
  return catalog.filter((l) => l.sport === sport && (kind == null || l.kind === kind));
}

/** A sport's leagues whose teams it lists: a league's teams belong to it; a cup's or a tournament's are its leagues'. */
export function teamLeagues(sport: Sport, catalog: readonly League[] = CATALOG): League[] {
  return indexedLeagues(catalog).filter((l) => l.sport === sport);
}

export interface SearchTeam {
  readonly option: TeamOption;
  readonly league: League;
}

export interface SearchResults {
  readonly competitions: readonly League[];
  readonly editions: readonly SeasonEvent[];
  readonly teams: readonly SearchTeam[];
}

export const NO_RESULTS: SearchResults = { competitions: [], editions: [], teams: [] };

/** Case and diacritics don't matter: "Atletico" finds "Atlético". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * What a search finds: competitions by name or sport, tournaments by name,
 * teams by name, each team once (under the first league that lists it),
 * names that start with what's typed first, at most `limit`.
 */
export function sportsSearch(query: string, directory: Readonly<Record<string, readonly TeamOption[]>>, editions: readonly SeasonEvent[], limit = 40, catalog: readonly League[] = CATALOG): SearchResults {
  const q = fold(query.trim());
  if (!q) return NO_RESULTS;
  const competitions = catalog.filter((l) => fold(`${l.name} ${SPORT_NAME[l.sport]}`).includes(q));
  const found = editions.filter((e) => fold(e.name).includes(q));
  const seen = new Set<string>();
  const teams: SearchTeam[] = [];
  for (const league of catalog) {
    for (const option of directory[league.id] ?? []) {
      if (!fold(option.name).includes(q) || seen.has(option.id)) continue;
      seen.add(option.id);
      teams.push({ option, league });
    }
  }
  const rank = (name: string) => (fold(name).startsWith(q) ? 0 : 1);
  teams.sort((a, b) => rank(a.option.name) - rank(b.option.name) || (a.option.name < b.option.name ? -1 : a.option.name > b.option.name ? 1 : 0));
  return { competitions, editions: found, teams: teams.slice(0, limit) };
}

/** "3 competitions · 1 team": Sports' line on its Following row. Null with nothing followed. */
export function followingSummary(competitions: number, teams: number): string | null {
  const parts = [competitions ? `${competitions} ${competitions === 1 ? "competition" : "competitions"}` : null, teams ? `${teams} ${teams === 1 ? "team" : "teams"}` : null].filter((x): x is string => x != null);
  return parts.length ? parts.join(" · ") : null;
}
