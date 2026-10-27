/**
 * Scroll memory for the split view's detail pane (RootView.swift
 * `scrollMemory`), which scrolls on its own, so the browser's restoration
 * never sees it:
 *
 * - A fresh visit (a link, a push) starts at the top.
 * - Back and Forward land where that page was left.
 * - The same page turned the other way in time (a schedule's Upcoming |
 *   Results, a replace on the same path) keeps each way's own place.
 * - Anything else that replaces the page (a new scope) starts at the top.
 *
 * Content often arrives after the page (lazy routes, data): a remembered
 * position is retried each frame until the page is tall enough, for up to a
 * second and a half, and the user's own scrolling ends the attempt.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType, type Location } from "react-router";

const byEntry = new Map<string, number>();
const byPage = new Map<string, number>();
const pageKey = (l: Pick<Location, "pathname" | "search">) => `${l.pathname}${l.search}`;

/** Where a navigation should land (pure, for tests): a remembered offset, or 0. */
export function landingOffset(
  type: "POP" | "PUSH" | "REPLACE",
  from: Pick<Location, "pathname"> | null,
  to: Pick<Location, "pathname" | "search" | "key">,
  memory: { entry: ReadonlyMap<string, number>; page: ReadonlyMap<string, number> },
): number {
  if (type === "POP") return memory.entry.get(to.key) ?? 0;
  if (type === "REPLACE" && from?.pathname === to.pathname) return memory.page.get(pageKey(to)) ?? 0;
  return 0;
}

const RETRY_MS = 1500;

export function useDetailScrollMemory(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  const location = useLocation();
  const type = useNavigationType();
  const last = useRef<Location | null>(null);
  // The entry on screen, updated as each navigation lands (scroll events arrive a frame later).
  const shown = useRef(location);

  // Remember where each entry (and page) is, as it scrolls.
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    let frame = 0;
    const save = () => {
      frame = 0;
      byEntry.set(shown.current.key, el.scrollTop);
      byPage.set(pageKey(shown.current), el.scrollTop);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(save);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);

  // Land each navigation: the top, or where this page was.
  useLayoutEffect(() => {
    const el = ref.current;
    const from = last.current;
    last.current = location;
    shown.current = location;
    if (!enabled || !el) return;
    const target = landingOffset(type, from, location, { entry: byEntry, page: byPage });
    el.scrollTop = target;
    if (target === 0 || Math.abs(el.scrollTop - target) < 1) return;
    // Not tall enough yet: keep trying as the page fills in, until the user takes over.
    const until = performance.now() + RETRY_MS;
    let frame = requestAnimationFrame(function retry() {
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 1 || performance.now() > until) return;
      frame = requestAnimationFrame(retry);
    });
    const stop = () => cancelAnimationFrame(frame);
    el.addEventListener("wheel", stop, { passive: true, once: true });
    el.addEventListener("touchstart", stop, { passive: true, once: true });
    el.addEventListener("keydown", stop, { once: true });
    return () => {
      stop();
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("keydown", stop);
    };
  }, [ref, enabled, location, type]);
}
