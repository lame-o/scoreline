/**
 * The league catalog, exactly as Models.swift `League.catalog`: ids, names,
 * short names, sources and order. The order is Add Sports' order within each
 * sport; the user's own order lives in Settings (`enabledLeagues`).
 */
import type { League, LeagueKind, Sport, Source } from "./models";

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

function league(id: string, name: string, sport: Sport, source: Source, kind: LeagueKind = "league"): League {
  return { id, name, shortName: SHORT[id] ?? name, sport, kind, source };
}

export const CATALOG: readonly League[] = [
  league("eng.1", "Premier League", "soccer", espn("soccer/eng.1")),
  league("esp.1", "LaLiga", "soccer", espn("soccer/esp.1")),
  league("ita.1", "Serie A", "soccer", espn("soccer/ita.1")),
  league("ger.1", "Bundesliga", "soccer", espn("soccer/ger.1")),
  league("fra.1", "Ligue 1", "soccer", espn("soccer/fra.1")),
  league("eng.2", "Championship", "soccer", espn("soccer/eng.2")),
  league("usa.1", "MLS", "soccer", espn("soccer/usa.1")),

  league("eng.league_cup", "Carabao Cup", "soccer", espn("soccer/eng.league_cup"), "cup"),
  league("eng.fa", "FA Cup", "soccer", espn("soccer/eng.fa"), "cup"),
  league("esp.copa_del_rey", "Copa del Rey", "soccer", espn("soccer/esp.copa_del_rey"), "cup"),
  league("ger.dfb_pokal", "DFB-Pokal", "soccer", espn("soccer/ger.dfb_pokal"), "cup"),
  league("ita.coppa_italia", "Coppa Italia", "soccer", espn("soccer/ita.coppa_italia"), "cup"),

  league("uefa.champions", "Champions League", "soccer", espn("soccer/uefa.champions"), "tournament"),
  league("uefa.europa", "Europa League", "soccer", espn("soccer/uefa.europa"), "tournament"),
  league("uefa.europa.conf", "Conference League", "soccer", espn("soccer/uefa.europa.conf"), "tournament"),
  league("conmebol.libertadores", "Copa Libertadores", "soccer", espn("soccer/conmebol.libertadores"), "tournament"),
  league("fifa.world", "FIFA World Cup", "soccer", espn("soccer/fifa.world"), "tournament"),

  league("nfl", "NFL", "football", espn("football/nfl", true)),
  league("college-football", "College Football", "football", espn("football/college-football", true)),

  league("mlb", "MLB", "baseball", espn("baseball/mlb")),

  league("nba", "NBA", "basketball", espn("basketball/nba")),
  league("wnba", "WNBA", "basketball", espn("basketball/wnba")),

  league("cs2", "Counter-Strike 2", "esports", { kind: "counterStrike" }, "circuit"),

  league("ifsc", "World Climbing Series", "climbing", { kind: "ifsc" }, "circuit"),
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

/** A competition's identity at ESPN: dotted, lower-case ("eng.league_cup", "club.friendly"). */
export const isESPNSoccerSlug = (slug: string) => /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(slug);

/** Any competition ESPN has a soccer board for, listed or not: a team followed across competitions plays in all of them. Takes an ID or a path ("soccer/eng.fa"). */
export function leagueResolving(hint: string): League | undefined {
  const known = leagueWithID(hint) ?? CATALOG.find((l) => espnPath(l) === hint);
  if (known) return known;
  const slug = hint.startsWith("soccer/") ? hint.slice("soccer/".length) : hint;
  return isESPNSoccerSlug(slug) ? league(slug, slug, "soccer", espn(`soccer/${slug}`)) : undefined;
}

/** Whether it publishes a table: every soccer competition but a cup, and the two others the app draws one for. */
export function hasTable(l: League): boolean {
  return l.sport === "soccer" ? l.kind !== "cup" : ["nba", "college-football"].includes(l.id);
}

/** What Sports says a competition is. */
export function competitionKind(l: League): string {
  if (l.id === "cs2") return "Game · S-tier tournaments";
  if (l.id === "ifsc") return "Series · Competitions";
  return l.kind === "cup" ? "Cup" : l.kind === "tournament" ? "Tournament" : "League";
}

export function competitionHref(id: string): string {
  return `/sports/competition/${encodeURIComponent(id)}`;
}
