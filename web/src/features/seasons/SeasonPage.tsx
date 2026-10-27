/**
 * What every season page shares (ClimbingSeasonPage.swift, TournamentsPage.swift,
 * SeasonResultsViews.swift): the frame (the schedule header with the docked
 * bar hanging from it, the content, the freshness footer), the split layout
 * (the list and the open competition side by side from 680pt), the arrow
 * keys (↑/↓ move between competitions, →/← open and close, Return or Space
 * toggles; keys never animate), and the entrance (blocks stack in on a
 * click's arrival; a mode switch by click crossfades, by key is instant).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useLocation } from "react-router";
import { useWidth } from "../../design/useWidth";
import { isTyping } from "../../app/navigation";
import type { HoverStore } from "./hover";
import styles from "./SeasonPage.module.css";

/** The panel's split threshold: the list and the open competition side by side. */
export const SPLIT_POINTS = 680;

/** Whether a page arrived by a click (its blocks stack in) and how its content changes in place. */
export function useArrival(switched: boolean): { entrance: boolean } {
  const location = useLocation();
  const viaKeyboard = Boolean((location.state as { viaKeyboard?: boolean } | null)?.viaKeyboard);
  const [entrance] = useState(() => !switched && !viaKeyboard);
  return { entrance };
}

export function useSeasonWidth(root: RefObject<HTMLElement | null>): { width: number; split: boolean } {
  const width = useWidth(root, 340);
  return { width, split: width >= SPLIT_POINTS };
}

export interface SeasonKeysOptions {
  readonly hover: HoverStore;
  /** The rows the keys walk, top to bottom. */
  readonly ids: readonly string[];
  readonly split: boolean;
  /** Split: the arrows walk the list and the detail follows. */
  readonly onSelect?: (id: string) => void;
  /** Open or close in place (not split); `open` undefined toggles. Keys never animate. */
  readonly onToggle?: (id: string, open: boolean | undefined) => void;
  /** Return on a row that opens a page instead (a tournament's results). */
  readonly onActivate?: (id: string) => void;
}

/**
 * The page's keys, on its root (so a focused control elsewhere keeps its
 * keys, and the scores sidebar keeps its own). The highlight scrolls into
 * view clear of the header and the docked bar.
 */
export function useSeasonKeys(root: RefObject<HTMLElement | null>, { hover, ids, split, onSelect, onToggle, onActivate }: SeasonKeysOptions) {
  return useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const target = event.target as HTMLElement;
      // A menu or a control with its own arrows keeps them.
      if (target.closest('[role="menu"], [role="radiogroup"], [role="toolbar"]')) return;
      const move = (delta: number) => {
        if (ids.length === 0) return;
        event.preventDefault();
        const current = hover.id != null ? ids.indexOf(hover.id) : -1;
        const next = current < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(Math.max(current + delta, 0), ids.length - 1);
        const id = ids[next]!;
        hover.set(id, true);
        if (split) onSelect?.(id);
        root.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
      };
      const id = hover.id != null && ids.includes(hover.id) ? hover.id : null;
      switch (event.key) {
        case "ArrowDown":
          return move(1);
        case "ArrowUp":
          return move(-1);
        case "ArrowRight":
          if (id && !split && onToggle) {
            event.preventDefault();
            onToggle(id, true);
          }
          return;
        case "ArrowLeft":
          if (id && !split && onToggle) {
            event.preventDefault();
            onToggle(id, false);
          }
          return;
        case "Enter":
        case " ":
          if (!id || target.tagName === "BUTTON" || target.tagName === "A") return;
          event.preventDefault();
          if (onActivate) onActivate(id);
          else if (split) onSelect?.(id);
          else onToggle?.(id, undefined);
          return;
      }
    },
    [root, hover, ids, split, onSelect, onToggle, onActivate],
  );
}

/** Focuses the page on arrival so its keys work at once (without a ring or a scroll). */
export function useFocusOnArrival(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const active = document.activeElement;
    if (active && active !== document.body && !el.contains(active) && active.closest("main")) return;
    el.focus({ preventScroll: true });
  }, [root]);
}

export interface SeasonFrameProps {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly header: ReactNode;
  readonly footer: ReactNode;
  readonly children: ReactNode;
  readonly onKeyDown?: (event: KeyboardEvent) => void;
  /** Content changed in place by a click: it crossfades. */
  readonly crossfade?: boolean;
  /** A key for the content, so a new mode replaces it (and crossfades). */
  readonly contentKey?: string;
  readonly label: string;
}

/** The page: header, content, footer; the root takes the page's keys. */
export function SeasonFrame({ rootRef, header, footer, children, onKeyDown, crossfade = false, contentKey, label }: SeasonFrameProps) {
  return (
    <div ref={rootRef} className={styles.page} tabIndex={-1} onKeyDown={onKeyDown} aria-label={label} role="region">
      {header}
      <div key={contentKey} className={[styles.content, crossfade ? styles.crossfade : null].filter(Boolean).join(" ")}>
        {children}
      </div>
      {footer}
    </div>
  );
}

/** List and detail side by side (split), else the list alone. */
export function SplitColumns({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div className={styles.split}>
      <div className={styles.column}>{list}</div>
      <div className={[styles.column, styles.detailColumn].join(" ")}>{detail}</div>
    </div>
  );
}

/** The `stack-in` entrance for a block, cascading (Components.swift `StackIn`), merged with the block's own class. */
export function stackIn(entrance: boolean, index: number, className?: string | null): { className?: string; style?: React.CSSProperties } {
  if (!entrance) return className ? { className } : {};
  return { className: [className, "stack-in"].filter(Boolean).join(" "), style: { animationDelay: `${Math.min(index, 6) * 30}ms` } };
}

/** A ref that holds the latest value (for handlers that must act on the page as it is now). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
