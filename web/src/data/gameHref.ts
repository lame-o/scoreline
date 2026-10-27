/**
 * A game page's URL, with its league when the caller knows it, so the page
 * loads off the scoreboards too ("/game/espn-401908043?league=mlb").
 *
 * Its own module, so the shell (the tab's alerts, rows, profiles) can link a
 * game without pulling in the game page's loaders and parsers.
 */
export function gameHref(eventID: string, leagueID?: string | null): string {
  const path = `/game/${encodeURIComponent(eventID)}`;
  return leagueID ? `${path}?league=${encodeURIComponent(leagueID)}` : path;
}
