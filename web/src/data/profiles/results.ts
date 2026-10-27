/**
 * A team page's season context: its results and form (ResultsHub.swift
 * `TeamResultsSection`, ResultProvider.swift `TeamSeasons.summarize`) and a
 * window of the table around it (TeamPage.swift `standingsWindow`).
 *
 * These are the team page's own small reads. When the schedules and
 * standings layers land (ResultsStore, StandingsView), the page can take its
 * season and table from them; the URLs are the same, so the HTTP and edge
 * caches are shared either way.
 */
import { espnTeamID } from "../teams";
import type { Sport } from "../models";
import { parseGame } from "./espn";
import type { GameRef } from "./models";
import { arr, at, i, sAt, type JSONValue } from "./read";

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const STANDINGS = "https://site.api.espn.com/apis/v2/sports";

/** A team's season. Soccer: `soccer/all` covers every competition (ScheduleProvider.swift `teamURL`). */
export function teamScheduleURL(sport: Sport, path: string, team: string): string {
  return `${SITE}/${sport === "soccer" ? "soccer/all" : path}/teams/${team}/schedule`;
}

/** Friendlies don't count toward form (ResultProvider.swift `isFriendly`). */
function isFriendly(e: JSONValue): boolean {
  const league = `${sAt(e, "league", "slug") ?? ""} ${sAt(e, "league", "abbreviation") ?? ""} ${sAt(e, "league", "name") ?? ""}`.toLowerCase();
  return league.includes("friendly");
}

/** The season's finished games, newest first, friendlies aside. */
export function parseTeamResults(json: JSONValue, sport: Sport, path: string, teamID: string): GameRef[] {
  const seen = new Set<string>();
  return arr(at(json, "events"))
    .flatMap((e) => {
      if (isFriendly(e)) return [];
      // Each event carries its own competition (soccer/all mixes them).
      const league = sAt(e, "league", "abbreviation");
      const game = parseGame(e, sport, path, teamID);
      if (!game || game.state !== "final" || seen.has(game.id)) return [];
      // A postponed game comes back "post" with no winner and 0–0 placeholders.
      if (sAt(e, "competitions", 0, "status", "type", "name")?.includes("POSTPONED")) return [];
      seen.add(game.id);
      return [{ ...game, competition: game.competition ?? league }];
    })
    .sort((a, b) => b.date - a.date);
}

export interface FormMark {
  /** "W", "D", "L". */
  readonly letter: string;
  readonly id: string;
  /** "Sat, Oct 24 · W 2–0 vs Everton · Premier League". */
  readonly readout: string;
  /** "October 24, won 2 to 0 against Everton". */
  readonly spoken: string;
}

const WORD: Readonly<Record<string, string>> = { W: "won", L: "lost", D: "drew", T: "tied" };

/** The last `count` results as marks, oldest first. */
export function formMarks(results: readonly GameRef[], count = 5): FormMark[] {
  return results
    .filter((g) => g.result != null)
    .slice(0, count)
    .reverse()
    .map((g) => {
      const score = g.teamScore != null && g.opponentScore != null ? `${g.teamScore}–${g.opponentScore}` : null;
      const opponent = g.opponent ? `${g.home ? "vs" : "at"} ${g.opponent.name}` : null;
      const day = new Date(g.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      const long = new Date(g.date).toLocaleDateString("en-US", { month: "long", day: "numeric" });
      return {
        letter: g.result!,
        id: g.id,
        readout: [day, [g.result, score].filter(Boolean).join(" "), opponent, g.competition].filter(Boolean).join(" · "),
        spoken: [long, [WORD[g.result!] ?? g.result, score?.replace("–", " to ")].filter(Boolean).join(" "), g.opponent ? `against ${g.opponent.name}` : null]
          .filter(Boolean)
          .join(", "),
      };
    });
}

// MARK: - Standings window

export interface StandingsRow {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string | null;
  readonly logo: string | null;
  /** The table it's in (a conference, a group); null for a single table. */
  readonly group: string | null;
  /** Stat values by ESPN type and by name ("total", "vsconf", "points", "gamesPlayed"). */
  readonly stats: Readonly<Record<string, string>>;
}

export function standingsURL(path: string): string {
  return `${STANDINGS}/${path}/standings`;
}

/** Which league's table a team's page shows (TeamPage.swift `standingsLeague`): soccer, the NBA and college football. */
export function standingsPath(sport: Sport | null, teamID: string, soccerPath: string | null): string | null {
  switch (sport) {
    case "soccer":
      return soccerPath;
    case "basketball":
      return "basketball/nba";
    case "football":
      return teamID.startsWith("espn-ncaaf-") ? "football/college-football" : null;
    default:
      return null;
  }
}

export function parseStandings(json: JSONValue, path: string, sport: Sport): StandingsRow[] {
  const children = arr(at(json, "children"));
  const tables = children.length > 0 ? children : [json];
  return tables.flatMap((table) => {
    const group = children.length > 1 ? (sAt(table, "shortName") ?? sAt(table, "abbreviation") ?? sAt(table, "name")) : null;
    return arr(at(table, "standings", "entries")).flatMap((entry): StandingsRow[] => {
      const t = at(entry, "team");
      const id = sAt(t, "id");
      if (!id) return [];
      const stats: Record<string, string> = {};
      for (const stat of arr(at(entry, "stats"))) {
        const value = sAt(stat, "summary") ?? sAt(stat, "displayValue");
        if (value == null) continue;
        const type = sAt(stat, "type");
        const name = sAt(stat, "name");
        if (type && stats[type] == null) stats[type] = value;
        if (name && stats[name] == null) stats[name] = value;
      }
      return [{
        id: espnTeamID(path, sport, id),
        name: sAt(t, "shortDisplayName") ?? sAt(t, "displayName") ?? "",
        abbreviation: sAt(t, "abbreviation"),
        logo: sAt(t, "logos", 0, "href"),
        group,
        stats,
      }];
    });
  });
}

/** Seven rows of the team's own table around it (three either side, fewer at the edges). */
export function standingsWindow(rows: readonly StandingsRow[], teamID: string, options: { reach?: number; bySeed?: boolean } = {}): { rows: StandingsRow[]; first: number } {
  const { reach = 3, bySeed = false } = options;
  const own = rows.find((r) => r.id === teamID);
  if (!own) return { rows: [], first: 0 };
  let peers = rows.filter((r) => r.group === own.group);
  // The NBA's conferences are ranked by seed (ESPN lists them in another order); other tables arrive in table order.
  if (bySeed) peers = [...peers].sort((a, b) => (i(a.stats.playoffSeed) ?? 99) - (i(b.stats.playoffSeed) ?? 99));
  const j = peers.findIndex((r) => r.id === teamID);
  const size = 2 * reach + 1;
  const lo = Math.max(0, Math.min(j - reach, peers.length - size));
  return { rows: peers.slice(lo, lo + size), first: lo };
}
