/**
 * A team page's season context (TeamPage.swift `standingsLeague`): which
 * league's table it shows. The season itself is the schedules layer's
 * (state/schedule.ts `useTeamSeason`, ResultsStore.season) and the table the
 * standings layer's (state/standings.ts `useStandings`, ScoreStore.standings),
 * windowed by data/standings.ts `teamWindow`: the same URLs, loads and caches
 * as the results and standings pages.
 */
import type { Sport } from "../models";

/** Which league's table a team's page shows: soccer's domestic league, the NBA and college football ("soccer/eng.1"). */
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
