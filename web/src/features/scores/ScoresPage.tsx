/**
 * The scores page (ScoresView.swift): the header (title, live count, List |
 * Tiles, Schedule, Refresh, Settings), the games as a list or as tiles, and
 * the freshness footer. It's the whole page on a phone and the sidebar
 * beside the detail pane on wider screens.
 *
 * Keyboard (as on the Mac): ↑/↓ move through the games (←/→ too in Tiles),
 * Return opens the highlighted one, P shows it in the tab (the Mac's ⌘P,
 * Show in Menu Bar), Esc goes back (AppShell). Keyboard moves never
 * animate; the pointer's hover takes the highlight back. R, comma and S are
 * the app's (app/commands.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import { Button, Chip, EmptyState, ErrorState, Icon, IconButton, SegmentedControl, Skeleton } from "../../design/components";
import { plural, updatedAgo, clockTime } from "../../data/format";
import type { NavState } from "../../app/layout";
import { isTyping } from "../../app/navigation";
import { useNow } from "../../state/clock";
import { pin } from "../../state/pin";
import { useScoreboard } from "../../state/scores";
import { settings, type LandingView } from "../../state/settings";
import { useWidth, WIDTH } from "../../design/useWidth";
import { ScoresList } from "./ScoresList";
import { TileBoard } from "./TileBoard";
import styles from "./ScoresPage.module.css";

type Direction = "up" | "down" | "left" | "right";
const KEYS: Readonly<Record<string, Direction>> = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" };

export function ScoresPage({ variant }: { readonly variant: "page" | "sidebar" }) {
  const scores = useScoreboard();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const selectedID = decodeID(matchPath("/game/:id", pathname)?.params.id);
  const view = scores.settings.landingView;
  const root = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<{ id: string | null; keyboard: boolean }>({ id: null, keyboard: false });
  // A click on the switcher stacks the new view in; the keyboard switches instantly.
  const [arrival, setArrival] = useState(0);
  const active = variant === "sidebar" || pathname === "/";

  const onHover = useCallback((id: string) => setHighlight((h) => (h.id === id && !h.keyboard ? h : { id, keyboard: false })), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      // An open menu has the keys.
      if ((event.target as HTMLElement | null)?.closest?.('[role="menu"]')) return;
      const container = root.current;
      if (!container) return;
      const focused = document.activeElement as HTMLElement | null;
      const focusInList = focused != null && container.contains(focused);
      // Beside a detail page, keys aimed at a control there stay there.
      if (variant === "sidebar" && focused && focused !== document.body && !focusInList) return;
      const direction = KEYS[event.key];
      if (direction) {
        const from = focusInList && focused?.dataset.navId ? focused.dataset.navId : highlight.id;
        const next = nextCell(container, from, direction, view);
        if (!next) return;
        event.preventDefault();
        setHighlight({ id: next.id, keyboard: true });
        // Instantly, and clear of the sticky header (scroll-margin).
        next.element.scrollIntoView({ block: "nearest", behavior: "instant" as ScrollBehavior });
        if (focusInList) next.element.focus({ preventScroll: true });
        return;
      }
      if ((event.key === "p" || event.key === "P") && !event.repeat && highlight.id && container.querySelector(`[data-nav-id="${CSS.escape(highlight.id)}"]`)) {
        event.preventDefault();
        pin.toggle(highlight.id);
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && highlight.id && !(focused && (focused.tagName === "A" || focused.tagName === "BUTTON"))) {
        event.preventDefault();
        navigate(`/game/${encodeURIComponent(highlight.id)}`, { state: { viaKeyboard: true } satisfies NavState });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, highlight.id, navigate, variant, view]);

  const scrolled = useScrolled(root);
  const width = useWidth(root);
  const stale = scores.status === "offline";
  const followedIDs = scores.settings.followed.map((t) => t.id);
  // Every league failed and none has a game to show: one "Can't Load Scores" (ScoresView's
  // error state), not a column of per-league errors.
  const nothingLoaded = scores.status === "offline" && scores.sections.every((s) => s.events.length === 0);
  const empty = (scores.sections.length === 0 && scores.quietLeagues.length === 0) || nothingLoaded;

  // A click stacks the new view in; the keyboard switches instantly.
  const switchView = (next: LandingView, viaKeyboard: boolean) => {
    if (next === view) return;
    setArrival(viaKeyboard ? 0 : (n) => n + 1);
    settings.set("landingView", next);
  };

  return (
    <div className={styles.page} data-variant={variant} ref={root}>
      <span className={styles.sentinel} data-sentinel aria-hidden="true" />
      <header className={styles.header} data-scrolled={scrolled}>
        {/* On its own page the title is the h1; beside a page, the sidebar's heading. */}
        {variant === "page" ? <h1 className={styles.title}>Scores</h1> : <h2 className={styles.title}>Scores</h2>}
        {scores.liveCount > 0 ? (
          <Chip tone="live" label={`${plural(scores.liveCount, "game")} in progress`} title={`${plural(scores.liveCount, "game")} in progress`}>
            {scores.liveCount} Live
          </Chip>
        ) : null}
        <span className={styles.headerSpacer} />
        <div className={styles.controls}>
          <SegmentedControl
            label="View"
            value={view}
            onChange={switchView}
            iconsOnly
            options={[
              { value: "list", label: "List", icon: "list" },
              { value: "tiles", label: "Tiles", icon: "tiles" },
            ]}
          />
          <IconButton icon="calendar" label="Schedule" shortcut="S" onClick={() => navigate("/schedule")} />
          <RefreshButton onRefresh={scores.refresh} />
          <IconButton icon="sliders" label="Settings" shortcut="," onClick={() => navigate("/settings")} />
        </div>
      </header>

      <div className={[styles.content, arrival > 0 ? "stack-in" : null].filter(Boolean).join(" ")} key={view}>
        {scores.settings.enabledLeagues.length === 0 ? (
          <EmptyState
            icon="sportscourt"
            title="No Sports Yet"
            message="Choose the leagues you follow and their scores will live here."
            actions={<Button onClick={() => navigate("/settings")}>Add Sports</Button>}
          />
        ) : empty ? (
          scores.status === "offline" ? (
            <ErrorState subject="Scores" retriesAutomatically onRetry={() => void scores.refresh()} />
          ) : view === "tiles" ? (
            <SkeletonTiles />
          ) : (
            <SkeletonList />
          )
        ) : view === "tiles" ? (
          <TileBoard
            board={scores.board}
            collapsed={scores.settings.collapsed}
            followed={followedIDs}
            quietLeagues={scores.quietLeagues}
            hasFollowed={followedIDs.length > 0}
            highlight={highlight}
            selectedID={selectedID}
            stale={stale}
            onHover={onHover}
          />
        ) : (
          <ScoresList
            sections={scores.sections}
            collapsed={scores.settings.collapsed}
            quietLeagues={scores.quietLeagues}
            hasFollowed={followedIDs.length > 0}
            highlight={highlight}
            selectedID={selectedID}
            records={width - 28 >= WIDTH.medium}
            stale={stale}
            onHover={onHover}
          />
        )}
      </div>

      <Footer lastUpdated={scores.lastUpdated} offline={stale} fetching={scores.fetching} />
    </div>
  );
}

function decodeID(id: string | undefined): string | null {
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Refresh: one turn of the arrow per click; background polls show nothing. */
function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [turns, setTurns] = useState(0);
  return (
    <IconButton
      icon="refresh"
      label="Refresh"
      shortcut="R"
      turns={turns}
      onClick={() => {
        setTurns((t) => t + 1);
        void onRefresh();
      }}
    />
  );
}

/**
 * "Updated just now", re-read every 30 seconds; offline, it leads with a
 * glyph. Not a live region: the list never announces (Announcer's policy:
 * game pages only), or a screen reader would hear the minute turn on every page.
 */
function Footer({ lastUpdated, offline, fetching }: { lastUpdated: number | null; offline: boolean; fetching: boolean }) {
  const now = useNow(30_000);
  const text =
    lastUpdated == null ? (fetching ? "Updating…" : "") : offline ? `Can't connect · Updated ${clockTime(lastUpdated)}` : updatedAgo(lastUpdated, now);
  return (
    <footer className={styles.footer}>
      {/* Only beside its words: with nothing ever loaded, the error state above already says it. */}
      {offline && text ? <Icon name="wifiSlash" size={9.5} /> : null}
      <span>{text}</span>
    </footer>
  );
}

/** Whether content has scrolled under the sticky header (a sentinel leaves the top). */
function useScrolled(root: React.RefObject<HTMLDivElement | null>): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const sentinel = root.current?.querySelector("[data-sentinel]");
    if (!sentinel) return;
    const scroller = root.current?.closest("aside") ?? null;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), { root: scroller, threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [root]);
  return scrolled;
}

/**
 * The next game for an arrow key, from what's on screen: the list steps
 * through rows; tiles move to the nearest tile in the next row (↑/↓) or in
 * reading order (←/→). Read only on a key press.
 */
function nextCell(container: HTMLElement, current: string | null, direction: Direction, view: LandingView): { id: string; element: HTMLElement } | null {
  const cells = [...container.querySelectorAll<HTMLElement>("[data-nav-id]")].map((element) => ({
    id: element.dataset.navId!,
    element,
    rect: element.getBoundingClientRect(),
  }));
  if (cells.length === 0) return null;
  const index = cells.findIndex((c) => c.id === current);
  const forward = direction === "down" || direction === "right";
  if (index < 0) return forward ? cells[0]! : cells[cells.length - 1]!;
  if (view === "list" || direction === "left" || direction === "right") {
    if (view === "list" && (direction === "left" || direction === "right")) return null;
    return cells[Math.min(Math.max(index + (forward ? 1 : -1), 0), cells.length - 1)]!;
  }
  const here = cells[index]!;
  const rows = [...new Set(cells.map((c) => Math.round(c.rect.top)))].sort((a, b) => a - b);
  const row = rows.indexOf(Math.round(here.rect.top));
  const target = rows[row + (forward ? 1 : -1)];
  if (target == null) return here;
  const center = here.rect.left + here.rect.width / 2;
  const candidates = cells.filter((c) => Math.round(c.rect.top) === target);
  candidates.sort((a, b) => Math.abs(a.rect.left + a.rect.width / 2 - center) - Math.abs(b.rect.left + b.rect.width / 2 - center) || a.rect.left - b.rect.left);
  return candidates[0] ?? here;
}

function SkeletonList() {
  return (
    <div aria-label="Loading scores" role="status">
      <Skeleton width={90} height={8} className={styles.skeletonTitle} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={styles.skeletonRow}>
          <div className={styles.skeletonTeams}>
            {[0, 1].map((j) => (
              <div key={j} className={styles.skeletonLine}>
                <Skeleton circle width={14} height={14} />
                <Skeleton width={110} height={9} />
              </div>
            ))}
          </div>
          <Skeleton width={44} height={9} />
        </div>
      ))}
    </div>
  );
}

function SkeletonTiles() {
  return (
    <div aria-label="Loading scores" role="status">
      <Skeleton width={60} height={8} className={styles.skeletonTitle} />
      <div className={styles.skeletonTiles}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.skeletonTile} data-large={i === 0}>
            <Skeleton circle width={i === 0 ? 34 : 28} height={i === 0 ? 34 : 28} />
            <Skeleton width={i === 0 ? 48 : 30} height={i === 0 ? 14 : 10} />
            <Skeleton circle width={i === 0 ? 34 : 28} height={i === 0 ? 34 : 28} />
          </div>
        ))}
      </div>
    </div>
  );
}
