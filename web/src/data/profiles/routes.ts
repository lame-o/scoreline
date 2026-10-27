/**
 * Profile URLs: one readable path per team and per person, so a page can be
 * shared and reloaded, and the reference a link carries rebuilt from it.
 *
 *     /team/espn-football-12              a team, by its `Competitor.id`
 *     /team/espn-soccer-359?league=eng.1  a club, with its domestic league (its roster needs it)
 *     /team/cs-667                        a CS2 team
 *     /player/nba-1966                    an ESPN athlete: league, then ID
 *     /player/eng.1-253989                a footballer, under a soccer league
 *     /player/cs2-zywoo                   a CS2 player, by bo3.gg slug
 *     /player/ifsc-1147                   a climber
 *
 * Links pass the full reference in the history state as well, so the hero
 * paints the name, photo and team on the first frame (TeamLink, PlayerLink).
 *
 * The pages also accept the paths other pages built before these links
 * existed, so nothing they emit can 404:
 *
 *     /player/espn-baseball-33192?league=mlb   an ESPN athlete by sport, the league in the query (game pages)
 *     /player/ifsc-1147?name=&country=          a climber with their name and country (season pages)
 *     /team/cs-667?name=&logo=&league=cs2       a team with its name and crest (season pages)
 *     /team/espn-soccer-359                     a club from a table row, its league found from ESPN
 */
import { leagueForPath, playerRef, teamRef, type PlayerRef, type TeamRef } from "./models";

const US_LEAGUES: Readonly<Record<string, string>> = {
  nba: "basketball/nba",
  nfl: "football/nfl",
  "college-football": "football/college-football",
  mlb: "baseball/mlb",
};

export function teamHref(ref: Pick<TeamRef, "id" | "league">): string {
  const base = `/team/${encodeURIComponent(ref.id)}`;
  return ref.id.startsWith("espn-soccer-") && ref.league ? `${base}?league=${encodeURIComponent(ref.league)}` : base;
}

export function playerHref(ref: Pick<PlayerRef, "source" | "id">): string {
  return `/player/${encodeURIComponent(playerSlug(ref))}`;
}

/** The player part of the path ("nba-1966", "cs2-zywoo"). */
export function playerSlug(ref: Pick<PlayerRef, "source" | "id">): string {
  switch (ref.source.kind) {
    case "espn":
      return `${leagueForPath(ref.source.path) ?? ref.source.path.replace("/", ".")}-${ref.id}`;
    case "counterStrike":
      return `cs2-${ref.source.slug}`;
    case "ifsc":
      return `ifsc-${ref.id}`;
  }
}

/** A team reference from its route: the ID, and what the query says (`league`, and `name` and `logo` from older links). */
export function teamFromRoute(id: string, query: URLSearchParams | null = null): TeamRef | null {
  if (!id.startsWith("espn-") && !id.startsWith("cs-")) return null;
  return teamRef({
    id,
    name: query?.get("name") ?? "",
    logo: query?.get("logo") || null,
    league: query?.get("league") || (id.startsWith("cs-") ? "cs2" : null),
  });
}

/** An ESPN league ID as the path its athletes live under ("mlb" → "baseball/mlb", "eng.1" → "soccer/eng.1"). */
function pathForLeague(league: string): string | null {
  return US_LEAGUES[league] ?? (/^[a-z]{2,4}\.[\w.]+$/.test(league) ? `soccer/${league}` : null);
}

/** A sport's league when a link didn't say (`espn-baseball-…` without `?league=`). */
const SPORT_PATHS: Readonly<Record<string, string>> = {
  baseball: "baseball/mlb",
  basketball: "basketball/nba",
  football: "football/nfl",
  ncaaf: "football/college-football",
  // ESPN files a footballer's pages under any soccer league; "all" stands in until the bio names the club.
  soccer: "soccer/all",
};

/** A player reference from its route (and query), or null for a path that names no one. */
export function playerFromRoute(slug: string, query: URLSearchParams | null = null): PlayerRef | null {
  const name = query?.get("name") ?? "";
  if (slug.startsWith("cs2-") && slug.length > 4) {
    const s = slug.slice(4);
    return playerRef({ source: { kind: "counterStrike", slug: s }, id: s, name });
  }
  const dash = slug.lastIndexOf("-");
  if (dash <= 0) return null;
  const scope = slug.slice(0, dash);
  const id = slug.slice(dash + 1);
  if (!/^\d+$/.test(id)) return null;
  if (scope === "ifsc") return playerRef({ source: { kind: "ifsc" }, id, name, country: query?.get("country") || null });
  // Game pages' links: "espn-<sport>-<id>", the league in the query.
  if (scope.startsWith("espn-")) {
    const league = query?.get("league");
    const path = league ? pathForLeague(league) : (SPORT_PATHS[scope.slice(5)] ?? null);
    return path ? playerRef({ source: { kind: "espn", path }, id, name }) : null;
  }
  const path = pathForLeague(scope);
  return path ? playerRef({ source: { kind: "espn", path }, id, name }) : null;
}

/** What a link leaves in the history state for the page it opens. */
export interface ProfileNavState {
  readonly team?: TeamRef;
  readonly player?: PlayerRef;
  /** The page the link was on, for the Back button's title ("‹ Chiefs"). */
  readonly from?: string;
  /** Reached with the keyboard: no entrance animation. */
  readonly viaKeyboard?: boolean;
}
