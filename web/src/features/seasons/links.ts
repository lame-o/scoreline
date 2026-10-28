/**
 * Links out of the season pages: a CS2 team's reference for `TeamLink`, a
 * match or round on the game page. Climbers and teams are linked with the
 * profiles' `PlayerLink` and `TeamLink` (ProfileLinks.swift `PlayerNameLink`,
 * `TeamNameLink`), so their pages prefetch on a dwell and paint the name and
 * crest on the first frame.
 */
import { useMemo } from "react";
import { teamRef, type TeamRef } from "../../data/profiles/models";
import { bracketPath, type ScheduleTeam, type SeasonEvent } from "../../data/schedule";
import { useSettings } from "../../state/settings";

/** A CS2 team on a season page, by its competitor ID (`cs-667`). */
export function csTeamRef(team: ScheduleTeam): TeamRef {
  return teamRef({ id: team.id ?? team.name, name: team.name, logo: team.logo, league: "cs2" });
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
