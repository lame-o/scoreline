/**
 * An ESPN athlete as a link to their page, from a match page's or a table's
 * IDs (ProfileLinks.swift `PlayerRef.espn`). Its own small module, so name
 * links can import it without the parsers.
 */
import { playerRef, type PlayerRef } from "./models";

/** An ESPN player with a page (NBA, NFL, college football, MLB, soccer; not the WNBA or college basketball), or null. */
export function espnPlayerRef(path: string | null | undefined, id: string | null | undefined, name: string, fields: Partial<PlayerRef> = {}): PlayerRef | null {
  if (!path || !id) return null;
  if (!["basketball/nba", "football/nfl", "football/college-football", "baseball/mlb"].includes(path) && !path.startsWith("soccer/")) return null;
  return playerRef({ ...fields, source: { kind: "espn", path }, id, name });
}

