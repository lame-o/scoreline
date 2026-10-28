/**
 * Linked focus across charts (VizKit.swift `Focus`, `LinkedFocus`,
 * `LinkedRow`, `LinkedMarks`): what the pointer is on, shared by every chart
 * on a game page, so the same thing lights up wherever it appears. Hover a
 * scoring play and its ball rings on the spray chart and its inning cell
 * lights; hover an inning and its balls stand out.
 *
 * A source fills in what it knows (`Focus`); each chart reacts to the parts
 * it shows. The store lives outside React: hovering never re-renders the page,
 * only the small readers that subscribe with a selector (`useFocus`).
 *
 * Timing, as on the Mac: links appear once the pointer settles (80 ms), so
 * sweeping across the page doesn't set charts flickering; once showing they
 * follow the pointer at once; leaving has an 80 ms grace so crossing the gap
 * to a neighbor doesn't flash everything back. A clicked row pins its focus
 * (again, or Esc, unpins), which charts show whenever nothing is hovered.
 * While the pointer rests on the chart peek (core/peek.tsx) the hover it was
 * showing holds (`hold`), so leaving the row for the peek doesn't clear it.
 *
 *     const lit = useFocus((f) => matches(f, { play: ball.id, period: ball.period, side: ball.side }));
 *     <div {...linkedRow(focus, { pinnable: true })}>…</div>
 *     <canvas {...useLinkedMarks(points, (i) => ({ play: balls[i].id }))} />
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";
import type { Side } from "../../../data/models";

export interface Focus {
  /** ESPN play ID (key events, shots, scoring plays, batted balls, pitches). */
  readonly play?: string;
  /** Inning or quarter, 1-based, with the team batting or scoring. */
  readonly period?: number;
  readonly side?: Side | null;
  /** IFSC athlete ID. */
  readonly athlete?: number;
  /** CS2 round number on the map shown. */
  readonly round?: number;
  /** ESPN athlete ID (NBA: a box score row, and that player's shots). */
  readonly player?: string;
  /** A stretch of game time in elapsed seconds (an NBA run). */
  readonly span?: readonly [number, number];
}

export function sameFocus(a: Focus | null, b: Focus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.play === b.play &&
    a.period === b.period &&
    (a.side ?? null) === (b.side ?? null) &&
    a.athlete === b.athlete &&
    a.round === b.round &&
    a.player === b.player &&
    a.span?.[0] === b.span?.[0] &&
    a.span?.[1] === b.span?.[1]
  );
}

/** A play, or with no play, everything in a period (for one team, if given) (Focus.matches). */
export function matches(focus: Focus | null, mark: { play?: string | null; period?: number | null; side?: Side | null }): boolean {
  if (!focus) return false;
  if (focus.play != null) return focus.play === mark.play;
  if (focus.period == null || focus.period !== mark.period) return false;
  return focus.side == null || focus.side === mark.side;
}

const SETTLE_MS = 80;

/** The page's focus: hovered beats pinned (LinkedFocus). */
export class LinkedFocusStore {
  private hovered: Focus | null = null;
  private pinned: Focus | null = null;
  /** The pointer is on the chart peek: the hover stays. */
  private held = false;
  /** A focus waiting to show (the pointer hasn't rested yet), or a clear waiting out its grace (focus null). */
  private pending: { focus: Focus | null; timer: ReturnType<typeof setTimeout> } | null = null;
  private listeners = new Set<() => void>();

  /** What charts show: the hover, else the pin. */
  focus = (): Focus | null => this.hovered ?? this.pinned;
  pin = (): Focus | null => this.pinned;
  /** What's pointed at right now (null while only a pin shows). */
  hovering = (): Focus | null => this.hovered;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(hovered: Focus | null, pinned: Focus | null = this.pinned): void {
    if (sameFocus(hovered, this.hovered) && sameFocus(pinned, this.pinned)) return;
    this.hovered = hovered;
    this.pinned = pinned;
    for (const l of this.listeners) l();
  }

  private cancel(): void {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  /** The pointer entered (true) or left (false) a mark or row with this focus. */
  hover(next: Focus, inside: boolean): void {
    if (inside) {
      if (this.hovered) {
        // Warm: follow the pointer at once.
        this.cancel();
        this.set(next);
        return;
      }
      if (this.pending && this.pending.focus) {
        // Moving from mark to mark while the short wait runs just retargets it.
        this.pending.focus = next;
        return;
      }
      this.cancel();
      const timer = setTimeout(() => {
        const target = this.pending?.focus ?? null;
        this.pending = null;
        if (target) this.set(target);
      }, SETTLE_MS);
      this.pending = { focus: next, timer };
    } else {
      if (this.pending && sameFocus(this.pending.focus, next)) {
        // Left before it ever showed.
        this.cancel();
        return;
      }
      if (!sameFocus(this.hovered, next) || this.held) return;
      this.clearSoon();
    }
  }

  /** A short grace, so crossing the gap to a neighbor doesn't flash everything back. */
  private clearSoon(): void {
    this.cancel();
    const timer = setTimeout(() => {
      this.pending = null;
      if (!this.held) this.set(null);
    }, SETTLE_MS);
    this.pending = { focus: null, timer };
  }

  /** The pointer left the page: nothing is hovered. A pin stays, and so does a held hover. */
  clear(): void {
    if (this.held) return;
    this.cancel();
    this.set(null);
  }

  /**
   * The pointer entered (true) or left (false) the chart peek. Leaving starts
   * the usual grace before the hover clears; landing on a row in the meantime
   * simply takes over.
   */
  hold(on: boolean): void {
    this.held = on;
    if (!on && this.hovered) this.clearSoon();
  }

  togglePin(focus: Focus): void {
    this.set(this.hovered, sameFocus(this.pinned, focus) ? null : focus);
  }

  /** Pins `focus` (the peek, clicked: the highlight survives the scroll to its chart). */
  pinFocus(focus: Focus): void {
    this.set(this.hovered, focus);
  }

  /** Whether there was a pin to drop (Esc unpins before it goes back). */
  unpin(): boolean {
    if (!this.pinned) return false;
    this.set(this.hovered, null);
    return true;
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }
}

const LinkedContext = createContext<LinkedFocusStore | null>(null);

export function LinkedFocusProvider({ store, children }: { store: LinkedFocusStore; children: React.ReactNode }) {
  return <LinkedContext.Provider value={store}>{children}</LinkedContext.Provider>;
}

export function useLinkedStore(): LinkedFocusStore | null {
  return useContext(LinkedContext);
}

const none = () => () => {};
const nothing = () => null;

/**
 * A slice of the page's focus. Return a primitive (a boolean, an ID) so the
 * reader re-renders only when its answer changes.
 */
export function useFocus<T>(select: (focus: Focus | null) => T): T {
  const store = useLinkedStore();
  const getSnapshot = useCallback(() => select(store ? store.focus() : null), [store, select]);
  return useSyncExternalStore(store ? store.subscribe : none, getSnapshot, () => select(nothing()));
}

/** The pin, for rows that wear the selection wash while pinned. */
export function usePinned(focus: Focus): boolean {
  const store = useLinkedStore();
  const getSnapshot = useCallback(() => sameFocus(store?.pin() ?? null, focus), [store, focus]);
  return useSyncExternalStore(store ? store.subscribe : none, getSnapshot, () => false);
}

/**
 * Props for a list row that takes part in linked hover (`linkedRow`): it
 * reports its focus on pointer enter and leave; a pinnable row pins on click
 * (or Enter/Space) and says so to screen readers. A row holding links (names
 * that open a player's page) pins on a click anywhere but a link, and isn't a
 * button itself, so its links stay links for the keyboard and screen readers.
 */
export function useLinkedRow(focus: Focus, { pinnable = false, links = false }: { pinnable?: boolean; links?: boolean } = {}): HTMLAttributes<HTMLElement> & { "data-pinned"?: boolean } {
  const store = useLinkedStore();
  const pinned = usePinned(focus);
  const ref = useRef(focus);
  ref.current = focus;
  return useMemo(() => {
    const props: HTMLAttributes<HTMLElement> & { "data-pinned"?: boolean } = {
      onPointerEnter: (e: ReactPointerEvent) => {
        if (e.pointerType === "mouse") store?.hover(ref.current, true);
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType === "mouse") store?.hover(ref.current, false);
      },
    };
    if (pinnable && links) {
      props.onClick = (e) => {
        if (!(e.target as Element).closest("a")) store?.togglePin(ref.current);
      };
      props["data-pinned"] = pinned;
    } else if (pinnable) {
      props.onClick = () => store?.togglePin(ref.current);
      props.onKeyDown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          store?.togglePin(ref.current);
        }
      };
      props.role = "button";
      props.tabIndex = 0;
      props["aria-pressed"] = pinned;
      props["data-pinned"] = pinned;
    }
    return props;
  }, [store, pinnable, links, pinned]);
}

/** A hover target in a chart: a dot, or a line that can be pointed at anywhere along its length (HoverMark). */
export interface HoverMark {
  readonly x: number;
  readonly y: number;
  readonly x2?: number;
  readonly y2?: number;
}

function distance(mark: HoverMark, px: number, py: number): number {
  if (mark.x2 == null || mark.y2 == null) return Math.hypot(mark.x - px, mark.y - py);
  const dx = mark.x2 - mark.x;
  const dy = mark.y2 - mark.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(Math.max(((px - mark.x) * dx + (py - mark.y) * dy) / length, 0), 1);
  return Math.hypot(mark.x + t * dx - px, mark.y + t * dy - py);
}

/** The index of the mark nearest the pointer within `radius` (lines take a tighter 9pt reach). */
export function nearest(marks: readonly HoverMark[], px: number, py: number, radius = 14): number | null {
  let best: { index: number; d: number } | null = null;
  marks.forEach((mark, index) => {
    const reach = mark.x2 == null ? radius : Math.min(radius, 9);
    const d = distance(mark, px, py);
    if (d <= reach && d < (best?.d ?? Infinity)) best = { index, d };
  });
  return (best as { index: number } | null)?.index ?? null;
}

/**
 * Marks drawn on a canvas (or SVG) as hover targets: whichever is nearest the
 * pointer, within 14pt of the element's own coordinates (`scale` converts
 * CSS pixels to the marks' units), becomes the page's focus (LinkedMarks).
 */
export function useLinkedMarks(marks: readonly HoverMark[], focusOf: (index: number) => Focus, scale = 1) {
  const store = useLinkedStore();
  const current = useRef<Focus | null>(null);
  const latest = useRef({ marks, focusOf, scale });
  latest.current = { marks, focusOf, scale };
  useEffect(
    () => () => {
      if (current.current) store?.hover(current.current, false);
    },
    [store],
  );
  return useMemo(
    () => ({
      onPointerMove: (e: ReactPointerEvent<Element>) => {
        if (!store || e.pointerType !== "mouse") return;
        const rect = e.currentTarget.getBoundingClientRect();
        const { marks: m, focusOf: f, scale: s } = latest.current;
        const index = nearest(m, (e.clientX - rect.left) / s, (e.clientY - rect.top) / s, 14 / s);
        if (index != null) {
          const next = f(index);
          store.hover(next, true);
          current.current = next;
        } else if (current.current) {
          store.hover(current.current, false);
          current.current = null;
        }
      },
      onPointerLeave: () => {
        if (current.current) store?.hover(current.current, false);
        current.current = null;
      },
    }),
    [store],
  );
}
