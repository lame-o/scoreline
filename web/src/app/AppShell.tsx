/**
 * The frame every page sits in: on phones one column, from 760px a sidebar
 * with the scores beside the selected page (AppShell.module.css). The
 * sidebar stays mounted across pages, so the list keeps its scroll, its
 * highlight and its polling, as the Mac app keeps Scores built under every
 * page. On a phone the window scrolls and Back restores where the list was;
 * beside the sidebar the detail pane remembers each page's place itself
 * (`useDetailScrollMemory`). Esc goes back from anywhere but the scores; R,
 * comma and S refresh, open Settings and open the Schedule (`useAppCommands`).
 * What runs beside every page (the tab's live score, alerts) loads after
 * the first paint (LiveServices).
 */
import { lazy, Suspense, useEffect, useRef } from "react";
import { Outlet, ScrollRestoration } from "react-router";
import { leagueWithID } from "../data/leagues";
import { ScoresPage } from "../features/scores/ScoresPage";
import { getSettings } from "../state/settings";
import { useAppCommands } from "./commands";
import { isTyping, markSidebarNavigation, useGoBack, useTrail } from "./navigation";
import { useSplit } from "./layout";
import { useDetailScrollMemory } from "./scrollMemory";
import styles from "./AppShell.module.css";

const LiveServices = lazy(() => import("./LiveServices"));

export function AppShell() {
  const split = useSplit();
  const goBack = useGoBack();
  const detail = useRef<HTMLElement>(null);

  // Beside the sidebar, the detail pane scrolls on its own: a new page starts at its top, Back lands where it was.
  useDetailScrollMemory(detail, split);
  useAppCommands();
  // Every page visited, for Back's label (navigation.ts).
  useTrail();

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

  // Warm the pages a click is likely to open next, once the list has painted:
  // the game page and the pages of the sports you follow (each sport's is its own chunk).
  useEffect(() => {
    const warm = () => {
      void import("../features/game/GamePage");
      void import("../features/game/sportPages").then((m) => m.warmSportPages(getSettings().enabledLeagues.flatMap((id) => leagueWithID(id) ?? [])));
      void import("../features/settings/SettingsPage");
      // A game's menu, so the first right-click opens it at once.
      void import("../features/scores/GameMenuContent");
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
        <>
          {/* The sidebar comes first: a keyboard can skip its games to the page beside it. */}
          <a
            className={styles.skip}
            href="#main"
            onClick={(e) => {
              e.preventDefault();
              detail.current?.focus({ preventScroll: true });
            }}
          >
            Skip to Page
          </a>
          <aside
            className={styles.sidebar}
            aria-label="Scores"
            onClickCapture={markSidebarNavigation}
            onKeyDownCapture={(e) => {
              if (e.key === "Enter") markSidebarNavigation();
            }}
          >
            <ScoresPage variant="sidebar" />
          </aside>
        </>
      ) : null}
      <main className={styles.detail} id="main" ref={detail} tabIndex={-1}>
        <Outlet />
      </main>
      {/* On a phone the window scrolls: Back lands where you left the list, a new page at its top. */}
      <ScrollRestoration />
      <Suspense fallback={null}>
        <LiveServices />
      </Suspense>
    </div>
  );
}
