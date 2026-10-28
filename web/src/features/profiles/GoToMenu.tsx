/**
 * "Go to LeBron James", "Go to Arsenal" (ProfileLinks.swift `GoToPlayerItem`,
 * `GoToTeamItem`, `PlayerPageLink`; Music's wording).
 *
 * - `useGoToPlayer`: a row whose click is already taken (a box score line
 *   picks the player for the court, a climber's result pins them on the
 *   wall) still opens the person's page, from its context menu (a
 *   right-click, a long press on touch, Shift-F10 or the Menu key) or a
 *   double click. A right-click on the name itself, a link, keeps the
 *   browser's own menu (Open in New Tab).
 * - `useGoToTeam`: a game row on a team or player page (a link to the match)
 *   offers its opponent's page from its context menu, with Open in New Tab
 *   beside it, since the menu stands in for the browser's.
 *
 *     const goTo = useGoToPlayer(ref);
 *     <div className={styles.row} {...goTo.props}>…{goTo.menu}</div>
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ContextMenu, type ContextMenuPoint } from "../../design/components";
import { isSupportedTeam } from "../../data/profiles/models";
import { playerHref, teamHref, useLinkOrigin, type PlayerRef, type TeamRef } from "./ProfileLinks";

/** How long a touch must rest before the menu opens (as the game menu's). */
const LONG_PRESS_MS = 480;
const SLOP = 10;

const onLink = (target: EventTarget | null) => target instanceof Element && target.closest("a") != null;

export interface GoToMenu {
  readonly props: {
    readonly onContextMenu: (e: MouseEvent) => void;
    readonly onDoubleClick: (e: MouseEvent) => void;
    readonly onKeyDown: (e: KeyboardEvent) => void;
    readonly onPointerDown: (e: PointerEvent) => void;
    readonly onPointerMove: (e: PointerEvent) => void;
    readonly onPointerUp: () => void;
    readonly onPointerCancel: () => void;
    readonly onClickCapture: (e: MouseEvent) => void;
  } | null;
  readonly menu: ReactNode;
}

type Target = { readonly kind: "player"; readonly ref: PlayerRef } | { readonly kind: "team"; readonly ref: TeamRef };

/** A row's "Go to {name}" (null: no page for this person, nothing added). */
export function useGoToPlayer(player: PlayerRef | null): GoToMenu {
  return useGoTo(player ? { kind: "player", ref: player } : null, null);
}

/** A game row's "Go to {opponent}", with Open in New Tab for the row's own link (`href`). */
export function useGoToTeam(team: TeamRef | null, href: string): GoToMenu {
  return useGoTo(team && isSupportedTeam(team) ? { kind: "team", ref: team } : null, href);
}

function useGoTo(target: Target | null, href: string | null): GoToMenu {
  const navigate = useNavigate();
  const from = useLinkOrigin();
  const [at, setAt] = useState<ContextMenuPoint | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);

  const go = useCallback(() => {
    if (!target) return;
    if (target.kind === "player") navigate(playerHref(target.ref), { state: { player: target.ref, from: from ?? undefined } });
    else navigate(teamHref(target.ref), { state: { team: target.ref, from: from ?? undefined } });
  }, [navigate, target, from]);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  if (!target) return { props: null, menu: null };
  const name = target.ref.name;
  // A row that is itself a link (a game) takes the menu everywhere; elsewhere a name's link keeps the browser's.
  const skips = (t: EventTarget | null) => href == null && onLink(t);
  const open = (x: number, y: number, instant: boolean, from: HTMLElement | null) => {
    opener.current = from;
    setAt({ x, y, instant });
  };
  return {
    props: {
      onContextMenu: (e) => {
        if (skips(e.target)) return;
        e.preventDefault();
        open(e.clientX, e.clientY, false, e.currentTarget as HTMLElement);
      },
      onDoubleClick: (e) => {
        // A link row's click already went (the game); a double click is only for rows whose click is taken.
        if (href != null || onLink(e.target)) return;
        go();
      },
      onKeyDown: (e) => {
        if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
        e.preventDefault();
        const target = e.target as HTMLElement;
        const r = target.getBoundingClientRect();
        open(r.left + 24, r.top + Math.min(r.height / 2, 16), true, target);
      },
      onPointerDown: (e) => {
        swallowClick.current = false;
        // On touch a link row keeps the system's own press (its preview); other rows open the menu.
        if (e.pointerType === "mouse" || !e.isPrimary || href != null || onLink(e.target)) return;
        cancelPress();
        const { clientX: x, clientY: y } = e;
        const row = e.currentTarget as HTMLElement;
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            press.current = null;
            swallowClick.current = true;
            navigator.vibrate?.(8);
            open(x, y, false, row);
          }, LONG_PRESS_MS),
        };
      },
      onPointerMove: (e) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancelPress();
      },
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      // The tap that ended a long press doesn't also pick the row.
      onClickCapture: (e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    },
    menu: at ? (
      <ContextMenu
        label={name}
        at={at}
        entries={[
          { kind: "item", label: `Go to ${name}`, icon: target.kind === "player" ? "person" : "shield", onSelect: go },
          ...(href != null
            ? [{ kind: "separator" as const }, { kind: "item" as const, label: "Open in New Tab", icon: "external" as const, onSelect: () => void window.open(href, "_blank", "noopener") }]
            : []),
        ]}
        onClose={() => setAt(null)}
        returnFocus={opener.current}
      />
    ) : null,
  };
}
