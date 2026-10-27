/**
 * Going back, the Mac way: Back returns to whichever page opened this one;
 * a page opened directly (a shared link) goes back to the scores. Esc does
 * the same from anywhere except a text field.
 *
 * Back names where it goes (RootView's `backTitle`). Every history entry is
 * recorded in a trail as it's visited (its path, its back title from
 * `backTitleFor`, or the name a team or player page gives itself), kept in
 * sessionStorage so a reload keeps it. A page's Back reads the entry before
 * its own (`useBack`).
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { backButton, backTitleFor, type TrailEntry } from "./backTitles";
import type { NavState } from "./layout";
import { useSplit } from "./layout";

export function useGoBack(): (viaKeyboard?: boolean) => void {
  const navigate = useNavigate();
  return useCallback(
    (viaKeyboard = false) => {
      const idx = historyIndex();
      if (idx > 0) navigate(-1);
      else navigate("/", { replace: true, state: { viaKeyboard } satisfies NavState });
    },
    [navigate],
  );
}

/** Whether a key event is aimed at a text field (shortcuts stand aside). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

// MARK: - The trail

const TRAIL_KEY = "scoreline.trail";
/** Entries kept around the current one (a long session never grows the store without bound). */
const KEEP = 60;

function historyIndex(): number {
  if (typeof window === "undefined") return 0;
  return (window.history.state as { idx?: number } | null)?.idx ?? 0;
}

let trail: Record<number, TrailEntry> = readTrail();
let sidebarAt = -Infinity;

function readTrail(): Record<number, TrailEntry> {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<number, TrailEntry>) : {};
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();

function writeTrail(idx: number, entry: TrailEntry): void {
  const old = trail[idx];
  if (old && old.path === entry.path && old.title === entry.title && old.viaSidebar === entry.viaSidebar) return;
  trail = { ...trail, [idx]: entry };
  for (const key of Object.keys(trail)) if (Math.abs(Number(key) - idx) > KEEP) delete trail[Number(key)];
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {
    // Private mode or a full store: Back still works, it just says "Back".
  }
  for (const listener of listeners) listener();
}

function subscribeTrail(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The sidebar is about to open a page (a click or Return on one of its rows): beside it, that page needs no Back. */
export function markSidebarNavigation(): void {
  sidebarAt = performance.now();
}

/** Records each location as it's visited (AppShell). */
export function useTrail(): void {
  const location = useLocation();
  useEffect(() => {
    const idx = historyIndex();
    const path = location.pathname;
    const own = trail[idx];
    // A team or player page has named itself already (`useOwnBackTitle`) when it's the same page.
    const title = backTitleFor(path, location.search) ?? (own?.path === path ? own.title : null);
    writeTrail(idx, { path, title, viaSidebar: performance.now() - sidebarAt < 1000 || (own?.path === path && own.viaSidebar === true) });
    sidebarAt = -Infinity;
  }, [location.key, location.pathname, location.search]);
}

/** A page whose path can't name it (a team, a player) names itself for Back on the pages it opens ("‹ Chiefs"). */
export function useOwnBackTitle(title: string | null | undefined): void {
  const location = useLocation();
  useEffect(() => {
    if (!title) return;
    const idx = historyIndex();
    const own = trail[idx];
    writeTrail(idx, { path: location.pathname, title, viaSidebar: own?.path === location.pathname ? own.viaSidebar : undefined });
  }, [title, location.key, location.pathname]);
}

/** Back's label and whether it shows here (hidden beside the sidebar when the sidebar is where it leads). */
export function useBack(): { readonly title: string; readonly visible: boolean } {
  const location = useLocation();
  const split = useSplit();
  const current = useSyncExternalStore(subscribeTrail, () => trail, () => trail);
  const from = (location.state as { from?: unknown } | null)?.from;
  const idx = historyIndex();
  // On the first render of a new page its entry isn't recorded yet: whether the sidebar opened it is known now.
  const view =
    current[idx]?.path === location.pathname ? current : { ...current, [idx]: { path: location.pathname, title: null, viaSidebar: performance.now() - sidebarAt < 1000 } };
  return backButton(idx, view, typeof from === "string" && from ? from : null, split);
}
