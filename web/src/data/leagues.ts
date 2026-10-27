/**
 * The league catalog, exactly as Models.swift `League.catalog`: ids, names,
 * short names, sources and order. The order is Add Sports' order within each
 * sport; the user's own order lives in Settings (`enabledLeagues`).
 */
import type { League, Sport, Source } from "./models";

const espn = (path: string, weekly = false): Source => ({ kind: "espn", path, weekly });

/** Short names for tight spaces (Swift `League.shortName`); anything else uses the full name. */
const SHORT: Readonly<Record<string, string>> = {
  "eng.1": "EPL",
  "uefa.champions": "UCL",
  "uefa.europa": "UEL",
  "eng.2": "EFL Champ",
  "fifa.world": "World Cup",
  "college-football": "College",
  cs2: "CS2",
  ifsc: "Climbing",
};

function league(id: string, name: string, sport: Sport, source: Source): League {
  return { id, name, shortName: SHORT[id] ?? name, sport, source };
}

export const CATALOG: readonly League[] = [
  league("eng.1", "Premier League", "soccer", espn("soccer/eng.1")),
  league("uefa.champions", "Champions League", "soccer", espn("soccer/uefa.champions")),
  league("uefa.europa", "Europa League", "soccer", espn("soccer/uefa.europa")),
  league("esp.1", "LaLiga", "soccer", espn("soccer/esp.1")),
  league("ita.1", "Serie A", "soccer", espn("soccer/ita.1")),
  league("ger.1", "Bundesliga", "soccer", espn("soccer/ger.1")),
  league("fra.1", "Ligue 1", "soccer", espn("soccer/fra.1")),
  league("eng.2", "Championship", "soccer", espn("soccer/eng.2")),
  league("usa.1", "MLS", "soccer", espn("soccer/usa.1")),
  league("fifa.world", "FIFA World Cup", "soccer", espn("soccer/fifa.world")),

  league("nfl", "NFL", "football", espn("football/nfl", true)),
  league("college-football", "College Football", "football", espn("football/college-football", true)),

  league("mlb", "MLB", "baseball", espn("baseball/mlb")),

  league("nba", "NBA", "basketball", espn("basketball/nba")),
  league("wnba", "WNBA", "basketball", espn("basketball/wnba")),

  league("cs2", "Counter-Strike 2", "esports", { kind: "counterStrike" }),

  league("ifsc", "World Climbing Series", "climbing", { kind: "ifsc" }),
];

/** What a new user starts with (Swift `League.defaultIDs`). */
export const DEFAULT_LEAGUE_IDS: readonly string[] = ["eng.1", "uefa.champions", "nfl", "mlb", "cs2", "ifsc"];

const BY_ID = new Map(CATALOG.map((l) => [l.id, l]));

export function leagueWithID(id: string): League | undefined {
  return BY_ID.get(id);
}

/** "soccer/eng.1" for ESPN leagues, else null. */
export function espnPath(league: League): string | null {
  return league.source.kind === "espn" ? league.source.path : null;
}
