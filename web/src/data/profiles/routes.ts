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

/** A team reference from its route: the ID, and the league when the path says. */
export function teamFromRoute(id: string, league: string | null): TeamRef | null {
  if (!id.startsWith("espn-") && !id.startsWith("cs-")) return null;
  return teamRef({ id, name: "", league: league ?? (id.startsWith("cs-") ? "cs2" : null) });
}

/** A player reference from its route, or null for a path that names no one. */
export function playerFromRoute(slug: string): PlayerRef | null {
  if (slug.startsWith("cs2-") && slug.length > 4) {
    const s = slug.slice(4);
    return playerRef({ source: { kind: "counterStrike", slug: s }, id: s, name: "" });
  }
  const dash = slug.lastIndexOf("-");
  if (dash <= 0) return null;
  const scope = slug.slice(0, dash);
  const id = slug.slice(dash + 1);
  if (!/^\d+$/.test(id)) return null;
  if (scope === "ifsc") return playerRef({ source: { kind: "ifsc" }, id, name: "" });
  const path = US_LEAGUES[scope] ?? (/^[a-z]{2,4}\.[\w.]+$/.test(scope) ? `soccer/${scope}` : null);
  return path ? playerRef({ source: { kind: "espn", path }, id, name: "" }) : null;
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
