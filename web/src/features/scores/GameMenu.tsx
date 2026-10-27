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
import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Icon, type ContextMenuPoint } from "../../design/components";
import { scoreLine } from "../../data/format";
import type { ScoreEvent } from "../../data/models";

/** The menu's items and surface load on their own (GameMenuContent.tsx); `preloadGameMenu` warms them. */
const loadGameMenu = () => import("./GameMenuContent");
const GameMenu = lazy(loadGameMenu);
export const preloadGameMenu = (): void => void loadGameMenu();

/** How long a touch must rest before the menu opens (iOS's context menu takes about this). */
const LONG_PRESS_MS = 480;
/** Movement that turns a press into a scroll. */
const SLOP = 10;

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
    preloadGameMenu();
    // Android sends a contextmenu after the long press already opened it.
    if (performance.now() - openedAt.current < 700) return;
    open(e.clientX, e.clientY, false, link());
  };

  const onPointerDown = (e: PointerEvent) => {
    swallowClick.current = false;
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    preloadGameMenu();
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
      {at ? (
        <Suspense fallback={null}>
          <GameMenu event={event} at={at} onClose={close} returnFocus={opener.current} />
        </Suspense>
      ) : null}
    </div>
  );
});
