/**
 * A game's context menu, the same for rows and tiles (Tiles.swift
 * `EventContextMenu`): Open in Browser (the source's own page: ESPN, bo3.gg,
 * IFSC), Show in Tab (the web's Show in Menu Bar: the pinned game), Follow
 * or Unfollow each team, Go to each team's page, each team's schedule, and
 * Copy Score.
 *
 * Ways in, as the web has them: a right-click; the "…" that shows on hover
 * (pointer devices); a long press on touch (with a tick of haptics where the
 * device has them, and the link's own callout suppressed); and Shift-F10 or
 * the Menu key on a focused game, which opens it at once with the first item
 * highlighted (keyboard actions never animate).
 */
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ContextMenu, Icon, type ContextMenuPoint, type MenuEntry } from "../../design/components";
import { scoreLine, statusLine } from "../../data/format";
import { competitors, type ScoreEvent } from "../../data/models";
import { isSupportedTeam } from "../../data/profiles/models";
import type { ProfileNavState } from "../../data/profiles/routes";
import { schedulePath } from "../../data/schedule";
import { pin, useIsPinned } from "../../state/pin";
import { settings, useSettings } from "../../state/settings";
import { teamHref, teamRefFrom } from "../profiles/ProfileLinks";

/** How long a touch must rest before the menu opens (iOS's context menu takes about this). */
const LONG_PRESS_MS = 480;
/** Movement that turns a press into a scroll. */
const SLOP = 10;

/** The game's league from its source ("soccer/eng.1" → "eng.1"): a club's page needs it, and the WNBA has none. */
function leagueOfRef(event: ScoreEvent): string | null {
  if (event.ref?.kind === "counterStrike") return "cs2";
  return event.ref?.kind === "espn" ? (event.ref.path.split("/")[1] ?? null) : null;
}

/** The menu's items for a game (Mac order and words). */
export function useGameMenuEntries(event: ScoreEvent): MenuEntry[] {
  const navigate = useNavigate();
  const pinned = useIsPinned(event.id);
  const followed = useSettings((s) => s.followed);
  const go = (path: string) => () => navigate(path, { state: { from: "Scores" } });
  const entries: MenuEntry[] = [];
  const link = event.link;
  if (link) {
    entries.push({ kind: "item", label: "Open in Browser", icon: "compass", onSelect: () => void window.open(link, "_blank", "noopener,noreferrer") });
    entries.push({ kind: "separator" });
  }
  entries.push({ kind: "item", label: pinned ? "Remove from Tab" : "Show in Tab", icon: pinned ? "pinSlash" : "pin", shortcut: "P", onSelect: () => pin.toggle(event.id) });
  const teams = competitors(event).filter((c) => c.id != null);
  if (teams.length > 0) {
    entries.push({ kind: "separator" });
    for (const team of teams) {
      const following = followed.some((t) => t.id === team.id);
      entries.push({
        kind: "item",
        label: following ? `Unfollow ${team.name}` : `Follow ${team.name}`,
        icon: following ? "starSlash" : "starOutline",
        onSelect: () => settings.toggleFollow({ id: team.id!, name: team.name, logo: team.logo }),
      });
    }
    entries.push({ kind: "separator" });
    // "Go to Arsenal": the team's page, for the sports that have them (Music's wording).
    for (const team of teams) {
      const ref = teamRefFrom(team, leagueOfRef(event));
      if (isSupportedTeam(ref)) {
        entries.push({ kind: "item", label: `Go to ${team.name}`, icon: "shield", onSelect: () => navigate(teamHref(ref), { state: { team: ref, from: "Scores" } satisfies ProfileNavState }) });
      }
    }
    for (const team of teams) {
      entries.push({ kind: "item", label: `${team.name} Schedule`, icon: "calendar", onSelect: go(schedulePath({ kind: "team", team: { id: team.id!, name: team.name, logo: team.logo } })) });
    }
  }
  entries.push({ kind: "separator" });
  entries.push({ kind: "item", label: "Copy Score", icon: "copy", onSelect: () => void navigator.clipboard?.writeText(statusLine(event, Date.now())).catch(() => {}) });
  return entries;
}

function GameMenu({ event, at, onClose, returnFocus }: { event: ScoreEvent; at: ContextMenuPoint; onClose: () => void; returnFocus: HTMLElement | null }) {
  const entries = useGameMenuEntries(event);
  return <ContextMenu label={`${scoreLine(event, false)} Options`} at={at} entries={entries} onClose={onClose} returnFocus={returnFocus} />;
}

export interface GameMenuHostProps {
  readonly event: ScoreEvent;
  readonly className?: string;
  /** The "…" button's look (it shows on hover, on pointer devices). */
  readonly buttonClassName?: string;
  readonly children: ReactNode;
}

/**
 * Wraps a row or tile (its link stays the one control) with the ways into
 * its menu, and the menu when open.
 */
export const GameMenuHost = memo(function GameMenuHost({ event, className, buttonClassName, children }: GameMenuHostProps) {
  const [at, setAt] = useState<ContextMenuPoint | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const openedAt = useRef(0);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((x: number, y: number, instant: boolean, from: HTMLElement | null) => {
    openedAt.current = performance.now();
    opener.current = from;
    setAt({ x, y, instant });
  }, []);
  const close = useCallback(() => setAt(null), []);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const link = () => host.current?.querySelector<HTMLElement>("a") ?? null;

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    // Android sends a contextmenu after the long press already opened it.
    if (performance.now() - openedAt.current < 700) return;
    open(e.clientX, e.clientY, false, link());
  };

  const onPointerDown = (e: PointerEvent) => {
    swallowClick.current = false;
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    cancelPress();
    const { clientX: x, clientY: y } = e;
    press.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        press.current = null;
        swallowClick.current = true;
        navigator.vibrate?.(8);
        open(x, y, false, link());
      }, LONG_PRESS_MS),
    };
  };
  const onPointerMove = (e: PointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancelPress();
  };
  // The tap that ended a long press doesn't also open the game.
  const onClickCapture = (e: MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    const r = target.getBoundingClientRect();
    open(r.right - 12, r.top + Math.min(r.height / 2, 24), true, target);
  };

  return (
    <div
      ref={host}
      className={className}
      data-menu-open={at != null}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      {children}
      {buttonClassName ? (
        <button
          type="button"
          className={buttonClassName}
          tabIndex={-1}
          aria-haspopup="menu"
          aria-expanded={at != null}
          aria-label={`${scoreLine(event, false)} Options`}
          title="Options"
          onClick={(e) => {
            if (at) return close();
            const r = e.currentTarget.getBoundingClientRect();
            open(r.right, r.bottom + 4, e.detail === 0, link());
          }}
        >
          <Icon name="ellipsis" size={10} />
        </button>
      ) : null}
      {at ? <GameMenu event={event} at={at} onClose={close} returnFocus={opener.current} /> : null}
    </div>
  );
});
