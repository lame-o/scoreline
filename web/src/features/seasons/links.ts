/**
 * Links out of the season pages: a climber's page, a CS2 team's page, a
 * match or round on the game page (ProfileLinks.swift `PlayerNameLink`,
 * `TeamNameLink`). Profile IDs follow the Mac's refs: climbers are
 * `ifsc-<athlete id>` (Profile.PlayerRef(source: .ifsc)), CS2 teams are their
 * competitor IDs (`cs-667`); the name and crest ride along as query values
 * so the page can title itself before it loads.
 */
import { useMemo } from "react";
import { bracketPath, type ScheduleTeam, type SeasonEvent } from "../../data/schedule";
import { useSettings } from "../../state/settings";

export function climberPath(athleteID: number, name: string, country: string | null): string {
  const q = new URLSearchParams({ name });
  if (country) q.set("country", country);
  return `/player/ifsc-${athleteID}?${q}`;
}

export function csTeamPath(team: ScheduleTeam): string {
  const q = new URLSearchParams({ name: team.name, league: "cs2" });
  if (team.logo) q.set("logo", team.logo);
  return `/team/${encodeURIComponent(team.id ?? team.name)}?${q}`;
}

export function gamePath(id: string): string {
  return `/game/${encodeURIComponent(id)}`;
}

/** Followed CS2 teams ("cs-667"). */
export function useFollowedCS(): ReadonlySet<string> {
  const followed = useSettings((s) => s.followed);
  return useMemo(() => new Set(followed.map((t) => t.id).filter((id) => id.startsWith("cs-"))), [followed]);
}

/** The bracket for a tournament: it knows teams by bo3.gg's bare ID ("667"), as the match page passes them. */
export function tournamentBracketPath(e: SeasonEvent, followed: ReadonlySet<string>): string | null {
  if (e.kind.kind !== "tournament") return null;
  return bracketPath({ kind: "csTournament", slug: e.kind.slug, name: e.name }, [...followed].map((id) => id.slice(3)));
}
