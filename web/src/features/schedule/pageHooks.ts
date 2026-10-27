/**
 * What the schedule pages share beyond their data: the row highlight (the
 * pointer's quiet hover, the keyboard's accent), the arrow keys, the scroll
 * spy (which day is at the top), jumping to a day, and folding days with
 * the scores list's choreography (SchedulePage.swift `toggle`, `move`,
 * `step`, ScrollSpy). Keyboard actions never animate.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { isTyping } from "../../app/navigation";
import type { ScheduleScope } from "../../data/schedule";
import { scheduleSession } from "../../state/schedule";

export interface Highlight {
  readonly id: string | null;
  readonly keyboard: boolean;
}

export function useHighlight() {
  const [highlight, setHighlight] = useState<Highlight>({ id: null, keyboard: false });
  const onHover = useCallback((id: string) => setHighlight((h) => (h.id === id && !h.keyboard ? h : { id, keyboard: false })), []);
  return { highlight, setHighlight, onHover };
}

/** The scroller a page lives in: the split view's detail pane, or the window. */
function scroller(el: Element | null): HTMLElement | null {
  const main = el?.closest("main") as HTMLElement | null;
  return main && getComputedStyle(main).overflowY !== "visible" ? main : null;
}

/** The sticky chrome's height, kept on the page as `--schedule-chrome` (scroll margins, the spy's line). */
export function useChromeHeight(page: RefObject<HTMLElement | null>, chrome: RefObject<HTMLElement | null>): RefObject<number> {
  const height = useRef(140);
  useLayoutEffect(() => {
    const el = chrome.current;
    const root = page.current;
    if (!el || !root) return;
    const read = () => {
      height.current = el.getBoundingClientRect().height;
      root.style.setProperty("--schedule-chrome", `${Math.round(height.current) + 4}px`);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [page, chrome]);
  return height;
}

/**
 * Which day is at the top of the agenda: the latest day whose heading has
 * passed under the chrome. Each heading reports only when it crosses, and
 * the page re-renders only when the answer changes (at most once per day
 * scrolled past).
 */
export function useScrollSpy(page: RefObject<HTMLElement | null>, chromeHeight: RefObject<number>, dayIDs: readonly string[]): string | null {
  const [top, setTop] = useState<string | null>(null);
  const key = dayIDs.join(",");
  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const above = new Set<string>();
    const headings = [...root.querySelectorAll<HTMLElement>("[data-day]")];
    if (headings.length === 0) {
      setTop(null);
      return;
    }
    const scrollRoot = scroller(root);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.day!;
          const line = (entry.rootBounds?.top ?? 0) + 1;
          if (!entry.isIntersecting && entry.boundingClientRect.top < line) above.add(id);
          else above.delete(id);
        }
        const latest = [...above].sort().pop() ?? null;
        setTop((t) => (t === latest ? t : latest));
      },
      { root: scrollRoot, rootMargin: `-${Math.round(chromeHeight.current ?? 140) + 8}px 0px 0px 0px`, threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [page, chromeHeight, key]);
  return top;
}

const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Scrolls a day's heading up to just under the chrome: smoothly by click, at once by keyboard. */
export function scrollToDay(page: HTMLElement | null, day: string, animated: boolean) {
  const el = page?.querySelector<HTMLElement>(`[data-day="${day}"]`);
  el?.scrollIntoView({ block: "start", behavior: animated && !reduceMotion() ? "smooth" : ("instant" as ScrollBehavior) });
}

/** Scrolls the page back to its top. */
export function scrollToTop(page: HTMLElement | null, animated: boolean) {
  const root = scroller(page);
  const behavior = animated && !reduceMotion() ? "smooth" : ("instant" as ScrollBehavior);
  if (root) root.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

export interface RowKeys {
  /** Row IDs on screen, in reading order. */
  readonly rows: readonly string[];
  readonly highlight: Highlight;
  readonly setHighlight: (h: Highlight) => void;
  readonly onOpen: (id: string) => void;
  /** ←/→. */
  readonly onStep: (direction: number) => void;
  /** T: Today (Results: Latest). */
  readonly onToday?: () => void;
}

/**
 * ↑/↓ move the highlight through the rows (instantly, scrolled into view
 * clear of the chrome), ←/→ step the navigator, Return opens, T goes to
 * Today. Keys aimed at a text field or a control's own keys stay there.
 */
export function useRowKeys(page: RefObject<HTMLElement | null>, keys: RowKeys) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const target = event.target as HTMLElement | null;
      // Menus, radio groups and the like handle their own arrows.
      if (target?.closest('[role="menu"], [role="radiogroup"], [role="toolbar"]')) return;
      const k = latest.current;
      switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
          if (k.rows.length === 0) return;
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const i = k.highlight.id ? k.rows.indexOf(k.highlight.id) : -1;
          const next = i < 0 ? (delta > 0 ? 0 : k.rows.length - 1) : Math.min(Math.max(i + delta, 0), k.rows.length - 1);
          const id = k.rows[next]!;
          k.setHighlight({ id, keyboard: true });
          page.current?.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
          return;
        }
        case "ArrowLeft":
        case "ArrowRight":
          event.preventDefault();
          k.onStep(event.key === "ArrowRight" ? 1 : -1);
          return;
        case "Enter":
        case " ":
          if (target && (target.tagName === "A" || target.tagName === "BUTTON")) return;
          if (k.highlight.id && k.rows.includes(k.highlight.id)) {
            event.preventDefault();
            k.onOpen(k.highlight.id);
          }
          return;
        case "t":
        case "T":
          if (k.onToday) {
            event.preventDefault();
            k.onToday();
          }
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page]);
}

/** Toggles faster than this skip the show (ScoresView.toggle). */
const RAPID_MS = 450;
const CHOREOGRAPHY_MS = 800;

export interface DayToggling {
  /** The day toggling with the full choreography (crests link), or null. */
  readonly linking: string | null;
  /** The day just unfolded by click (its rows stagger in) or folded (its summary waits). */
  readonly just: string | null;
  /** True while any toggle animates (the days below glide). */
  readonly animating: boolean;
}

/**
 * The scores list's section toggle, for a day. A deliberate click links the
 * preview's crests to the rows', then unfolds on the next frame so the
 * crests travel while the text staggers in. Clicks faster than that (or
 * Reduce Motion) skip the show; a key press changes instantly.
 */
export function useDayToggle(scope: ScheduleScope, isOpen: (day: string) => boolean) {
  const [toggling, setToggling] = useState<DayToggling>({ linking: null, just: null, animating: false });
  const last = useRef(0);
  const generation = useRef(0);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  const toggle = useCallback(
    (day: string, viaKeyboard: boolean) => {
      const flip = () => scheduleSession.setOpen(scope, day, !openRef.current(day));
      const now = performance.now();
      const rapid = now - last.current < RAPID_MS;
      last.current = now;
      const mine = ++generation.current;
      if (viaKeyboard || rapid || reduceMotion()) {
        setToggling({ linking: null, just: null, animating: false });
        flip();
        return;
      }
      setToggling({ linking: day, just: null, animating: true });
      requestAnimationFrame(() => {
        if (generation.current !== mine) {
          flip();
          return;
        }
        setToggling({ linking: day, just: day, animating: true });
        flip();
        window.setTimeout(() => {
          if (generation.current === mine) setToggling({ linking: null, just: null, animating: false });
        }, CHOREOGRAPHY_MS);
      });
    },
    [scope],
  );

  /** Unfolds a day being jumped to (the strip, the arrow keys, "Next"), instantly. */
  const unfold = useCallback(
    (day: string) => {
      if (!openRef.current(day)) scheduleSession.setOpen(scope, day, true);
    },
    [scope],
  );

  return { toggling, toggle, unfold };
}
