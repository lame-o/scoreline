/**
 * Media queries as hooks, and the size of a Mac point in CSS pixels (the
 * root font size over 13: 1px on desktops, 15/13 on touch screens).
 */
import { useSyncExternalStore } from "react";

const queries = new Map<string, MediaQueryList>();

function query(q: string): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  let mql = queries.get(q);
  if (!mql) {
    mql = window.matchMedia(q);
    queries.set(q, mql);
  }
  return mql;
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mql = query(q);
      mql?.addEventListener("change", listener);
      return () => mql?.removeEventListener("change", listener);
    },
    () => query(q)?.matches ?? false,
    () => false,
  );
}

/** Reduce Motion: anything that moves becomes a short fade, never nothing. */
export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");

export const prefersReducedMotion = () => query("(prefers-reduced-motion: reduce)")?.matches ?? false;

/** One Mac point in CSS pixels. */
export function pointSize(): number {
  if (typeof document === "undefined") return 1;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
}
