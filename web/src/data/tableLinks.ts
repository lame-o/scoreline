/**
 * A league's ways to its tables, without the tables (the scores list's
 * section menu is on the first paint; `standings.ts` and its parsers aren't).
 * Re-exported from `standings.ts`.
 */
import { espnPath } from "./leagues";
import type { League } from "./models";
import { rankingsPath, standingsPath } from "./schedule";

/** The NBA's path (its standings carry seeds). */
const NBA_PATH = "basketball/nba";

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

