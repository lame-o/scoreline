/**
 * The frame every page sits in: on phones one column, from 760px a sidebar
 * with the scores beside the selected page (AppShell.module.css). The
 * sidebar stays mounted across pages, so the list keeps its scroll, its
 * highlight and its polling, as the Mac app keeps Scores built under every
 * page. On a phone the window scrolls and Back restores where the list was.
 * Esc goes back from anywhere but the scores.
 */
import { useEffect, useRef } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { ScoresPage } from "../features/scores/ScoresPage";
import { isTyping, useGoBack } from "./navigation";
import { useSplit } from "./layout";
import styles from "./AppShell.module.css";

export function AppShell() {
  const split = useSplit();
  const goBack = useGoBack();
  const { pathname } = useLocation();
  const detail = useRef<HTMLElement>(null);

  // Beside the sidebar, the detail pane scrolls on its own: a new page starts at its top.
  useEffect(() => {
    if (split && detail.current) detail.current.scrollTop = 0;
  }, [pathname, split]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Read where we are now, not at the last render: a navigation may not have committed yet.
      if (event.key !== "Escape" || window.location.pathname === "/" || event.defaultPrevented || isTyping(event.target)) return;
      event.preventDefault();
      goBack(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  // Warm the pages a click is likely to open next, once the list has painted.
  useEffect(() => {
    const warm = () => {
      void import("../features/game/GamePage");
      void import("../features/settings/SettingsPage");
    };
    const idle = window.requestIdleCallback?.(warm, { timeout: 3000 });
    const timer = idle == null ? window.setTimeout(warm, 1500) : undefined;
    return () => {
      if (idle != null) window.cancelIdleCallback?.(idle);
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className={styles.shell} data-split={split}>
      {split ? (
        <aside className={styles.sidebar} aria-label="Scores">
          <ScoresPage variant="sidebar" />
        </aside>
      ) : null}
      <main className={styles.detail} id="main" ref={detail}>
        <Outlet />
      </main>
      {/* On a phone the window scrolls: Back lands where you left the list, a new page at its top. */}
      <ScrollRestoration />
    </div>
  );
}
