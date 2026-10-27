/**
 * The app's core values, ported from Models.swift and LiveSnapshot.swift.
 * Plain, immutable, serializable data: dates are epoch milliseconds, absent
 * values are `null`, so React Query can share structure between polls and an
 * unchanged game compares equal field by field.
 *
 * Naming: Swift's `Event` is `ScoreEvent` here (`Event` is a DOM global).
 * Everything else keeps its Swift name.
 */

// MARK: - Sports

export type Sport = "soccer" | "football" | "baseball" | "basketball" | "esports" | "climbing";

/** In the order Add Sports lists them (Swift `Sport.allCases`). */
export const SPORTS: readonly Sport[] = ["soccer", "football", "baseball", "basketball", "esports", "climbing"];

export const SPORT_NAME: Readonly<Record<Sport, string>> = {
  soccer: "Soccer",
  football: "Football",
  baseball: "Baseball",
  basketball: "Basketball",
  esports: "Esports",
  climbing: "Climbing",
};

// MARK: - Leagues

/** Where a league's scores come from (Swift `Source`). */
export type Source =
  /** ESPN scoreboard, e.g. "soccer/eng.1". Weekly leagues (NFL, college) are fetched as the current week; the rest day by day. */
  | { readonly kind: "espn"; readonly path: string; readonly weekly: boolean }
  | { readonly kind: "counterStrike" }
  | { readonly kind: "ifsc" };

export interface League {
  readonly id: string;
  readonly name: string;
  /** For tight spaces (small tiles): "EPL", "UCL", "CS2". */
  readonly shortName: string;
  readonly sport: Sport;
  readonly source: Source;
}

// MARK: - Events

export type EventState = "live" | "scheduled" | "final";

/** Live first, then upcoming, then finished (Swift `EventState: Comparable`). */
export const STATE_ORDER: Readonly<Record<EventState, number>> = { live: 0, scheduled: 1, final: 2 };

/** A side of a head-to-head: `top` is the first competitor (away in North American sports, home in soccer). */
export type Side = "top" | "bottom";

export interface Competitor {
  /** Stable across refreshes and seasons; used to follow a team. See `ESPNTeamID`. */
  readonly id: string | null;
  readonly name: string;
  /** Short code for tight spaces ("ARS", "NAVI"). */
  readonly abbreviation: string;
  readonly score: string | null;
  readonly logo: string | null;
  readonly isWinner: boolean;
  /** Team color as a hex string ("ef0107"), when the source provides one. */
  readonly color: string | null;
  /** College: AP Top 25 rank, when ranked. */
  readonly rank: number | null;
  /** Season record ("7–1") and, in college, the conference record ("4–1"). */
  readonly record: string | null;
  readonly conferenceRecord: string | null;
  /** The team's second color, for when its first clashes with the opponent's. */
  readonly alternateColor: string | null;
}

export type Content =
  /** Head-to-head. Top/bottom follow each sport's convention. */
  | { readonly kind: "match"; readonly top: Competitor; readonly bottom: Competitor }
  /** A field event (a climbing round): a title and a one-line summary. */
  | { readonly kind: "field"; readonly title: string; readonly summary: string };

/** Where to fetch an event's detail page from (Swift `EventRef`). */
export type EventRef =
  | { readonly kind: "espn"; readonly path: string; readonly id: string; readonly sport: Sport }
  | { readonly kind: "counterStrike"; readonly slug: string; readonly tournament: string | null }
  | {
      readonly kind: "climbing";
      readonly eventID: number;
      /** "Lead Women"; empty for a whole upcoming competition. */
      readonly category: string;
      /** The live or last finished round's results path. */
      readonly resultURL: string | null;
      /** The round underway or up next. */
      readonly round: string | null;
      readonly eventName: string;
      /** The next round's results path while it hasn't started (its starting order). */
      readonly nextURL: string | null;
    };

/**
 * A game clock as the source last read it (Swift `GameClock`): counting down
 * (football, basketball) or up in minutes (soccer). Whether it runs is
 * inferred from two readings in a row; see `clockText` and `clockReading`.
 */
export interface GameClock {
  readonly seconds: number;
  /** When it was read (epoch ms). */
  readonly sampledAt: number;
  readonly period: number;
  readonly direction: "down" | "up";
  /** The source's own text when read ("3:10 - 2nd", "37'", "45'+2'"). */
  readonly display: string;
  readonly running: boolean;
}

export interface ScoreEvent {
  readonly id: string;
  readonly content: Content;
  readonly state: EventState;
  /** Epoch ms. */
  readonly start: number;
  /** Short live/final detail from the source ("67'", "Top 9th", "Final/OT"). */
  readonly detail: string | null;
  /** Context such as tournament or round name. */
  readonly caption: string | null;
  /** The source's own page for the event. */
  readonly link: string | null;
  readonly ref: EventRef | null;
  /** Competition stage when the source says ("regular-season", "post-season"). */
  readonly stage: string | null;
  /** The game clock while live, for sports with one. */
  readonly clock: GameClock | null;
  /** Football, live: the competitor ID of the team with the ball. */
  readonly possession: string | null;
  /** Live: the situation in a line ("3rd & 7 at HOU 25", "1 out · 2–1 · Runner on 2nd"). */
  readonly liveLine: string | null;
  /** NBA: the live line is only routine (a rebound, a timeout); the previous line is kept instead. */
  readonly liveLineRoutine: boolean;
  /** Where to watch (US national networks, up to two) and where it's played. */
  readonly broadcast: string | null;
  readonly venue: string | null;
  /** Live only: what a tile draws beyond the score. Null when the source didn't say. */
  readonly snapshot: LiveSnapshot | null;
}

export function competitors(event: ScoreEvent): readonly Competitor[] {
  return event.content.kind === "match" ? [event.content.top, event.content.bottom] : [];
}

/** Stable identity for a competitor in views: survives score changes. */
export function competitorKey(c: Competitor): string {
  return c.id ?? c.name;
}

/** The sport, from where the event comes from. */
export function eventSport(event: ScoreEvent): Sport | null {
  switch (event.ref?.kind) {
    case "espn":
      return event.ref.sport;
    case "counterStrike":
      return "esports";
    case "climbing":
      return "climbing";
    default:
      return null;
  }
}

/**
 * A copy with some fields changed. Like Swift's `Event.with`, a snapshot
 * describes a game in progress, so it doesn't survive leaving `live`.
 */
export function withChanges(event: ScoreEvent, changes: Partial<ScoreEvent>): ScoreEvent {
  const next = { ...event, ...changes };
  return next.state === "live" ? next : { ...next, snapshot: null };
}

/**
 * Whether this side steps back (dims) in a finished match: it lost a game
 * someone won. Nobody steps back on a draw, before the end, or in a field
 * event. The one rule for rows, tiles, the hero and the docked bar.
 */
export function stepsBack(event: ScoreEvent, c: Competitor): boolean {
  if (event.state !== "final" || event.content.kind !== "match") return false;
  const { top, bottom } = event.content;
  return !c.isWinner && (top.isWinner || bottom.isWinner);
}

/** Cup ties and playoffs don't count toward a league table. */
export function isKnockout(event: ScoreEvent): boolean {
  const s = event.stage?.toLowerCase();
  if (!s) return false;
  return s.includes("knockout") || s.includes("playoff") || s.startsWith("round-of") || s.includes("final");
}

/** ESPN serves a light-on-dark variant of most logos alongside the default one. */
export function darkLogo(logo: string | null): string | null {
  if (!logo || !logo.includes("/500/")) return null;
  return logo.replace("/500/", "/500-dark/");
}

// MARK: - Live snapshots (LiveSnapshot.swift)

/** Ball spot and line to gain on a 0…100 field from the top (left) team's goal line. */
export interface FootballSpot {
  readonly ballX: number;
  /** Null between downs and when it's goal to go. */
  readonly lineToGainX: number | null;
  readonly possession: Side | null;
  readonly redZone: boolean;
  readonly down: number | null;
  readonly distance: number | null;
  readonly goalToGo: boolean;
}

export interface BaseState {
  readonly onFirst: boolean;
  readonly onSecond: boolean;
  readonly onThird: boolean;
  readonly balls: number;
  readonly strikes: number;
  readonly outs: number;
  readonly batter: string | null;
  readonly pitcher: string | null;
}

export interface MatchMark {
  readonly kind: "goal" | "penalty" | "ownGoal" | "redCard";
  /** Match minute, stoppage included ("90'+3'" → 93). */
  readonly minute: number;
  /** The side the mark belongs to; null only for an own goal whose side can't be told. */
  readonly side: Side | null;
  readonly player: string | null;
  /** The source's clock text ("64'", "45'+2'"). */
  readonly clock: string;
}

/**
 * bo3.gg's live feed for the map being played (Swift `GameDetail.CSLive`).
 * It exists only while bo3.gg's parser covers the match; otherwise rounds
 * arrive after each map. Read by `parseLive` (providers/counterStrike.ts).
 */
export interface CSLive {
  readonly mapName: string | null;
  /** Which map of the series (1-based). */
  readonly mapNumber: number | null;
  readonly round: number | null;
  readonly topScore: number;
  readonly bottomScore: number;
  /** "CT" or "T". */
  readonly topSide: "CT" | "T" | null;
  readonly bottomSide: "CT" | "T" | null;
  readonly mapEnded: boolean;
}

/** An athlete on (or waiting for) the wall. */
export interface WallAthlete {
  readonly name: string;
  readonly flag: string | null;
  /** IOC code ("JPN"). */
  readonly country: string | null;
}

export interface WallAscent {
  readonly athlete: WallAthlete;
  /** Hold number, +0.5 when moving to the next ("38+"). */
  readonly height: number;
  readonly top: boolean;
  /** "38+", "Top". */
  readonly label: string;
}

export type WallReach = "none" | "lowZone" | "zone" | "top";

/**
 * Who's on the wall in a live climbing round (Swift `WallState`), read from
 * the IFSC results the provider already fetches for the leader
 * (`wallStateFrom`, data/wallState.ts).
 */
export interface WallState {
  readonly phase:
    | { readonly kind: "lead"; readonly climber: WallAscent; readonly leader: WallAscent | null; readonly route: string | null }
    | { readonly kind: "boulder"; readonly athlete: WallAthlete; readonly cells: readonly WallReach[]; readonly active: number | null }
    | { readonly kind: "upNext"; readonly athlete: WallAthlete };
}

export type LiveSnapshot =
  | { readonly kind: "football"; readonly spot: FootballSpot }
  | { readonly kind: "baseball"; readonly bases: BaseState }
  /** Goals and red cards so far (empty: none yet; the track still shows time). */
  | { readonly kind: "soccer"; readonly marks: readonly MatchMark[] }
  | { readonly kind: "basketball"; readonly lastPlay: string | null }
  | { readonly kind: "counterStrike"; readonly live: CSLive }
  | { readonly kind: "climbing"; readonly wall: WallState };

/** One league's latest result (Swift `LeagueResult`). */
export interface LeagueResult {
  readonly events: readonly ScoreEvent[];
  /** The last refresh failed; `events` are the last good ones. */
  readonly failed: boolean;
}

/** A followed team, as Settings keeps it (Swift `FollowedTeam`). */
export interface FollowedTeam {
  readonly id: string;
  readonly name: string;
  readonly logo: string | null;
}
