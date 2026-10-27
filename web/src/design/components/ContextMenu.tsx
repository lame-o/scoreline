/**
 * ContextMenu: the design system's Menu where the pointer is (`.contextMenu`
 * in SwiftUI: a right-click, a long press, Shift-F10), in a layer over the
 * page, so a scrolling pane never clips it. It opens down and right of the
 * point and flips at the window's edges, growing from the corner nearest
 * it. Scrolling, resizing or leaving the window closes it. Its own module,
 * so pages that never open one don't carry it.
 *
 *     {menu ? <ContextMenu label="Arsenal vs Chelsea" at={menu} entries={…} onClose={() => setMenu(null)} /> : null}
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { enabledFrom, flatten, MenuSurface, useClosing, type MenuEntry } from "./Menu";
import styles from "./Menu.module.css";

export interface ContextMenuPoint {
  /** Viewport coordinates (CSS pixels) the menu opens from. */
  readonly x: number;
  readonly y: number;
  /** Opened from the keyboard: no entrance, the first item highlighted. */
  readonly instant: boolean;
}

export interface ContextMenuProps {
  readonly label: string;
  readonly at: ContextMenuPoint;
  readonly entries: readonly MenuEntry[];
  /** Called once it has gone (after its exit). */
  readonly onClose: () => void;
  /** Where focus returns after a keyboard close (the row it was opened on). */
  readonly returnFocus?: HTMLElement | null;
}

const EDGE = 8;

export function ContextMenu({ label, at, entries, onClose, returnFocus }: ContextMenuProps) {
  const id = useId();
  const surface = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ style: CSSProperties; origin: string }>({ style: { left: at.x, top: at.y, visibility: "hidden" }, origin: "top-left" });
  const { closing, close } = useClosing(onClose);
  const first = at.instant ? enabledFrom(flatten(entries), 0, 1) : -1;

  // Down and right of the point; flipped at the window's edges, growing from the corner nearest the point.
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = at.x + width > vw - EDGE ? Math.max(EDGE, at.x - width) : at.x;
    const top = at.y + height > vh - EDGE ? Math.max(EDGE, at.y - height) : at.y;
    const origin = `${top < at.y ? "bottom" : "top"}-${left < at.x ? "right" : "left"}`;
    setPlace({ style: { left, top }, origin });
  }, [at]);

  // Take the keys once it's placed (a hidden element can't take focus).
  const placed = place.style.visibility !== "hidden";
  useLayoutEffect(() => {
    if (placed) surface.current?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const dismiss = () => close(false);
    const onPointer = (event: PointerEvent) => {
      if (!surface.current?.contains(event.target as Node)) close(false);
    };
    const onScroll = (event: Event) => {
      if (!surface.current?.contains(event.target as Node)) close(true);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [close]);

  return createPortal(
    <MenuSurface
      id={id}
      label={label}
      entries={entries}
      initialActive={first}
      instant={at.instant}
      closing={closing}
      className={`${styles.menu} ${styles.contextMenu}`}
      style={place.style}
      origin={place.origin}
      surfaceRef={surface}
      onChoose={(item) => {
        close(true);
        if (at.instant) returnFocus?.focus({ preventScroll: true });
        item.onSelect();
      }}
      onDismiss={(back) => {
        close(true);
        if (back) returnFocus?.focus({ preventScroll: true });
      }}
    />,
    document.body,
  );
}
