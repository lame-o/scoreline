/**
 * The seam between the game core and each sport's page. A sport is a hook,
 * `useXPage(game)`, that returns its sections (rendered, or null when there's
 * nothing to show) and what it adds to the hero and the docked bar. The core
 * places the sections (data/sections.ts: the sport's order in one column, its
 * plan in two), runs the hero, the bar, moments and linked focus, and polls
 * the detail; the sport runs its own fast lane (`useFastLane`) and offers its
 * moments to `game.moments`.
 *
 * To add a sport (see ARCHITECTURE.md § Game pages):
 * 1. Port its detail parse into data/gameDetail.ts (or data/<sport>.ts) and
 *    its live lane into data/liveFeeds/<sport>.ts, with fixture tests.
 * 2. Write `features/game/<sport>/<Sport>Page.tsx` exporting `use<Sport>Page`:
 *    call `useCommonSections(game, …)` for the shared ones (line score, win
 *    probability, scoring, plays, where to watch), add the sport's own, and
 *    return them with the hero's clock text, possession and the bar's detail.
 * 3. Register it in `SPORT_PAGES` (GamePage.tsx) under its `PageKind`.
 */
import { useEffect, useRef, type ReactNode } from "react";
import type { GameDetail } from "../../../data/gameDetail";
import type { AccessoryTier } from "../../../data/matchRules";
import type { GameClock, ScoreEvent, Side } from "../../../data/models";
import type { Section } from "../../../data/sections";
import type { TeamPalette } from "../../../data/teamColors";
import type { PageGeometry } from "./geometry";
import type { MomentSlot } from "./moments";

/** Everything a sport's page reads, from the core. */
export interface GameContext {
  readonly event: ScoreEvent;
  readonly detail: GameDetail;
  /** Team colors fitted to the scheme (TeamPalette); null for field events. */
  readonly palette: TeamPalette;
  /** Short names for charts ("MIL"), and the full ones for screen readers. */
  readonly names: { readonly top: string; readonly bottom: string };
  readonly spoken: { readonly top: string; readonly bottom: string };
  readonly live: boolean;
  /** Two columns (from 680pt). */
  readonly split: boolean;
  readonly moments: MomentSlot;
  readonly geometry: PageGeometry;
  /** The scoreboard's league ID for the event ("mlb"), when known. */
  readonly leagueID: string | null;
  /** An out-of-cycle detail refresh (the fast lane saw a score). */
  readonly refresh: () => void;
}

/** What a sport's page gives the core. */
export interface SportPage {
  /** Rendered sections; null (or absent) when a section has nothing to show. */
  readonly sections: Partial<Record<Section, ReactNode>>;
  /** The lane's score, top first, while it's ahead of the scoreboard (never behind it). */
  readonly laneScores?: { readonly top: string; readonly bottom: string } | null;
  /** What the clock line says without a running clock (the inning, half-time). */
  readonly clockFallback?: string | null;
  /** The live clock when the sport's lane reads it closer than the scoreboard (football's and the NBA's 5-second readings). */
  readonly clock?: GameClock | null;
  /** Under the hero's clock ("MIL batting"). */
  readonly heroSecond?: string | null;
  /** Spoken with the hero ("Brewers batting"). */
  readonly heroSpoken?: string | null;
  /** Football and NBA, live: who has the ball (the hero, and the docked bar's possession slots). */
  readonly possession?: Side | null;
  /** The docked bar's live detail beside the score, given its room. */
  readonly dockDetail?: (tier: AccessoryTier) => ReactNode;
  /** One state chip on the bar (2-MIN DRILL, CLUTCH). */
  readonly chip?: string | null;
  /**
   * Field events (climbing): the colors the page's wash takes (the flag of
   * whoever the round is about); null keeps the accent wash. A change
   * crossfades like a change of light.
   */
  readonly wash?: TeamPalette | null;
  /** Field events: the docked bar's lead in place of the title (the climber on the wall), given its room. */
  readonly dockLead?: (tier: AccessoryTier) => ReactNode;
  /** Under the hero card (CS2: the co-streamer's badge). */
  readonly heroBadge?: ReactNode;
  /** A trophy in the hero: beside a series winner's name, or on a decided final's winner line. */
  readonly trophy?: Side | "field" | null;
  /** NBA: a shot in the air (the possession glyph dims, still the shooting team's). */
  readonly possessionInAir?: boolean;
  /** A state chip beside the hero's live clock (CLUTCH). */
  readonly heroChip?: string | null;
  /** A line under the hero's status, in any state: a two-legged tie's aggregate, a shootout ("Agg 3–2 · Pens 4–3"). */
  readonly heroNote?: string | null;
  /**
   * A field event's summary from the page's own lane ("Final · Leader 🇸🇮 L. Rakovec"), in place of the
   * scoreboard's, which can lag it by a poll: the hero then names the leader the results list ranks first.
   */
  readonly fieldSummary?: string | null;
  /** What sits beside each team's name on the docked bar (the possession glyph, red cards), given its room. */
  readonly dockSlot?: (side: Side, tier: AccessoryTier) => ReactNode;
}

export type UseSportPage = (game: GameContext) => SportPage;

const isHidden = () => document.visibilityState === "hidden";

/** The fast lane's cadence (DetailView.fastLane): 5 s; soccer 8 s; climbing 4 s. */
export const LANE_INTERVAL = { standard: 5000, soccer: 8000, climbing: 4000 } as const;

/**
 * Small, frequent requests while live and only while the page is open and
 * visible: one `tick` at a time, `interval` ms apart (from the end of the last
 * one). Stops when the game isn't live, the page goes away, or the tab hides;
 * catches up the moment the tab is shown again.
 */
export function useFastLane(active: boolean, interval: number, tick: (signal: AbortSignal) => Promise<void>): void {
  const latest = useRef(tick);
  latest.current = tick;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    const run = async () => {
      if (running || controller.signal.aborted) return;
      if (isHidden()) return;
      running = true;
      try {
        await latest.current(controller.signal);
      } catch {
        // Lanes fail quietly; the next tick tries again.
      } finally {
        running = false;
      }
      if (!controller.signal.aborted && !isHidden()) timer = setTimeout(run, interval);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void run();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void run();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, interval]);
}
