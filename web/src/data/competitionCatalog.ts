/** Presentation capabilities, shared in meaning with CompetitionCatalog.swift.
 * A game/series is a discovery scope; its editions have their own identity. */
import type { League } from "./models";
export function competitionKind(league: League): string {
  if (league.id === "cs2") return "Game · S-tier tournaments";
  if (league.id === "ifsc") return "Series · Competitions";
  if (["eng.league_cup", "eng.fa"].includes(league.id)) return "Cup";
  if (["uefa.champions", "uefa.europa", "fifa.world"].includes(league.id)) return "Tournament";
  return "League";
}
export function hasTable(league: League): boolean {
  return (league.sport === "soccer" && !["eng.league_cup", "eng.fa"].includes(league.id)) || ["nba", "college-football"].includes(league.id);
}
export function competitionHref(id: string): string { return `/sports/competition/${encodeURIComponent(id)}`; }
