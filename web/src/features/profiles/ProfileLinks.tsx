/**
 * Name links to team and player pages, for any page to drop in
 * (ProfileLinks.swift `QuietLink`, `RowLink`, `TeamNameLink`,
 * `PlayerNameLink`).
 *
 *     <TeamLink team={teamRefFrom(competitor, league)}>{competitor.name}</TeamLink>
 *     <PlayerLink player={espnPlayerRef(path, athlete.id, athlete.name)}>{athlete.name}</PlayerLink>
 *     <PlayerLink player={ref} variant="row">…a whole roster row…</PlayerLink>
 *
 * - `quiet` (the default): a name inside text. It looks like a name until you
 *   point at it: underlined under a fine pointer, dimmed a little while
 *   pressed, never colored.
 * - `row`: a row whose whole purpose is the thing it names (a roster row, a
 *   leader): the list's quiet hover fill, and the name inside underlines.
 *
 * A pointer that rests on a link for 250ms prefetches the page's first
 * request and the hero's photo (at most six a minute, never on a frugal
 * connection, once per link), so the page usually paints complete. Touch
 * prefetches on press. A team or person without a page (the WNBA, a null
 * reference) renders the children as plain text, so callers never branch.
 *
 * The link carries the full reference in the history state, so the page's
 * hero paints on its first frame, and the name of the page it was on, for
 * the Back button. Wrap a page in `<LinkOrigin name="Chiefs">` to set it.
 *
 * This module is light on purpose (no parsers, no page code): the scores
 * list or a game page can import it without growing their chunk. The
 * prefetch code and the page load on the first dwell.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { Competitor } from "../../data/models";
import { isSupportedTeam, playerRef, teamRef, type PlayerRef, type TeamRef } from "../../data/profiles/models";
import { playerHref, teamHref, type ProfileNavState } from "../../data/profiles/routes";
import styles from "./ProfileLinks.module.css";

export { espnPlayerRef } from "../../data/profiles/espnRef";
export { playerHref, teamHref } from "../../data/profiles/routes";
export type { PlayerRef, TeamRef };

const Origin = createContext<string | null>(null);

/** The page links inside it are on ("Chiefs"), for the Back title of the pages they open. */
export function LinkOrigin({ name, children }: { readonly name: string | null; readonly children: ReactNode }) {
  return <Origin.Provider value={name}>{children}</Origin.Provider>;
}

/** A team from a match row or hero (`Profile.TeamRef(competitor, league:)`). */
export function teamRefFrom(c: Competitor, league: string | null): TeamRef {
  return teamRef({
    id: c.id ?? c.name,
    name: c.name,
    logo: c.logo,
    league,
    color: c.color,
    alternateColor: c.alternateColor,
    abbreviation: c.abbreviation || null,
  });
}

/** A person whose page is known (a bo3 player, a climber), for callers holding a slug or an ID. */
export const counterStrikePlayerRef = (slug: string, name: string, fields: Partial<PlayerRef> = {}) =>
  playerRef({ ...fields, source: { kind: "counterStrike", slug }, id: fields.id ?? slug, name });
export const climberRef = (id: string | number, name: string, fields: Partial<PlayerRef> = {}) => playerRef({ ...fields, source: { kind: "ifsc" }, id: String(id), name });

const DWELL_MS = 250;

/** Calls `prefetch` once after a pointer rests on the element for 250ms, or at once on a touch press. */
export function useDwellPrefetch(prefetch: () => void) {
  const timer = useRef<number | null>(null);
  const done = useRef(false);
  const latest = useRef(prefetch);
  latest.current = prefetch;
  const fire = useCallback(() => {
    if (done.current) return;
    done.current = true;
    latest.current();
  }, []);
  const cancel = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType === "touch" || done.current) return;
      cancel();
      timer.current = window.setTimeout(fire, DWELL_MS);
    },
    onPointerLeave: cancel,
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "touch") fire();
    },
  };
}

function warmTeam(team: TeamRef) {
  void import("../../state/profiles").then((m) => m.prefetchTeam(team));
  void import("./TeamPage");
}

function warmPlayer(player: PlayerRef) {
  void import("../../state/profiles").then((m) => m.prefetchPlayer(player));
  void import("./PlayerPage");
}

interface BaseProps {
  readonly children: ReactNode;
  /** "quiet" (a name in text), "row" (a whole row with the list's hover fill) or "plain" (no look of its own: the caller's class styles it, a table row). */
  readonly variant?: "quiet" | "row" | "plain";
  readonly className?: string;
  /** Overrides the tooltip ("Go to Arsenal"). */
  readonly title?: string;
  /** An accessible name when the children aren't the whole story (a row: "Jalen Brunson, number 11, …"). */
  readonly label?: string;
  /** `data-*` attributes for the caller's styles ({ mine: true } → `data-mine="true"`). */
  readonly dataset?: Readonly<Record<string, string | boolean | undefined>>;
  readonly draggable?: boolean;
}

const VARIANT_CLASS = { quiet: styles.quiet, row: styles.row, plain: undefined } as const;

function ProfileLink({ to, state, onDwell, title, label, variant = "quiet", className, dataset, draggable, children }: BaseProps & { to: string; state: ProfileNavState; onDwell: () => void }) {
  const navigate = useNavigate();
  const dwell = useDwellPrefetch(onDwell);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Return on a focused link (a click with no pointer): the page arrives with no entrance.
    if (e.detail === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      navigate(to, { state: { ...state, viaKeyboard: true } satisfies ProfileNavState });
    }
  };
  const data = Object.fromEntries(Object.entries(dataset ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[`data-${k}`, String(v)]])));
  return (
    <Link
      to={to}
      state={state}
      className={[VARIANT_CLASS[variant], className].filter(Boolean).join(" ") || undefined}
      title={title}
      aria-label={label}
      draggable={draggable}
      onClick={onClick}
      {...data}
      {...dwell}
    >
      {children}
    </Link>
  );
}

export interface TeamLinkProps extends BaseProps {
  /** null, or a team without a page: the children as plain text. */
  readonly team: TeamRef | null;
}

export function TeamLink({ team, children, className, title, ...rest }: TeamLinkProps) {
  const from = useContext(Origin);
  if (!team || !isSupportedTeam(team)) return <span className={className}>{children}</span>;
  return (
    <ProfileLink to={teamHref(team)} state={{ team, from: from ?? undefined }} onDwell={() => warmTeam(team)} title={title ?? (team.name ? `Go to ${team.name}` : undefined)} className={className} {...rest}>
      {children}
    </ProfileLink>
  );
}

export interface PlayerLinkProps extends BaseProps {
  /** null (no page for this person): the children as plain text. */
  readonly player: PlayerRef | null;
}

export function PlayerLink({ player, children, className, title, ...rest }: PlayerLinkProps) {
  const from = useContext(Origin);
  if (!player) return <span className={className}>{children}</span>;
  return (
    <ProfileLink to={playerHref(player)} state={{ player, from: from ?? undefined }} onDwell={() => warmPlayer(player)} title={title ?? (player.name ? `Go to ${player.name}` : undefined)} className={className} {...rest}>
      {children}
    </ProfileLink>
  );
}

/** The class a row link's name takes, so it underlines while its row is hovered. */
export const linkNameClass = styles.name;

/** A row link's look (the hover fill, the press), for rows that open something else (a game). */
export const rowLinkClass = styles.row;
