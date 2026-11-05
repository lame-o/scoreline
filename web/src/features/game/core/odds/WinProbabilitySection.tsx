/**
 * Win Probability, grown up (ODDS-SPEC.md "Where it lives", ODDS-DECISIONS.md
 * "The section"): Polymarket's market as a live line against ESPN's model
 * and DraftKings' pregame line, in the section's place in each sport's
 * layout. Live and before the game it's "Win Probability"; once over, "How
 * the Odds Moved", the whole game's story.
 *
 * - Odds off (Settings), a league Polymarket doesn't list, or no confident
 *   match: ESPN's bar exactly as before (CommonSections.tsx `WinProbability`),
 *   or nothing where there was nothing.
 * - Which market is this game's is found as the page opens (one cached
 *   listing and one small request), since it decides whether the section
 *   shows at all; until then ESPN's bar stands in where there was one. The
 *   history, the socket and the polling follow only while the section is on
 *   screen (state/odds.ts).
 *
 * The header row: each team and its chance (the top team left, the bottom
 * right; soccer's draw between), and one muted line with ESPN's model and
 * DraftKings' line for the top team, the longest wording that fits on one
 * line. A final's header is its result (the last price: "GS 100% · 0% MIN");
 * its muted line, where it began ("GS at tip-off: Polymarket 43% · …").
 *
 * While the page broadcasts (BROADCAST.md §3), the market is shown as it
 * stood at p: each tick at its own time once p reaches it (so the line moves
 * with the basket, not 50 s before it), the chart redrawn when p reaches the
 * next pending tick, scheduled, never polled (OddsSection.schedule); ESPN's
 * half comes up to p with the presented detail.
 */
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { oddsSchedule, shownUntil } from "../../../../data/broadcast/presentOdds";
import type { PresentationClock } from "../../../../data/broadcast/presentationClock";
import type { GameState } from "../../../../data/odds/chart";
import { seriesFor } from "../../../../data/odds/polymarket";
import { useOddsFeed, type OddsGame, type OddsSnapshot } from "../../../../state/odds";
import { useSettings } from "../../../../state/settings";
import { WinProbability } from "../CommonSections";
import { DetailSection } from "../DetailSection";
import type { GameContext } from "../sport";

/** Whether this game could have odds at all: odds on, an ESPN match in a league Polymarket lists. */
export function oddsPossible(game: GameContext, enabled: boolean): boolean {
  const ref = game.event.ref;
  return enabled && ref?.kind === "espn" && seriesFor(ref.path) != null && game.event.content.kind === "match";
}

/** Whether the section has anything for this game: odds possible, or ESPN's bar (live and before the game, as before). */
export function hasWinProbability(game: GameContext, enabled: boolean): boolean {
  return oddsPossible(game, enabled) || (game.detail.topWinProbability != null && game.event.state !== "final");
}

/** The section with the chart: its own chunk, fetched as the page starts looking for the market. */
const loadOddsSection = () => import("./OddsSection");
const OddsSection = lazy(() => loadOddsSection().then((m) => ({ default: m.OddsSection })));

/**
 * The market as it stood at p (OddsChartData.shown): each outcome's ticks up
 * to p, its price the newest of them; a re-render when p reaches the next
 * pending tick (one timer, re-planned with the clock), never per frame.
 * Without a clock (not broadcasting), the market as it is.
 */
function usePresentedOdds(snapshot: OddsSnapshot, clock: PresentationClock | null): OddsSnapshot {
  const [tick, wake] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!clock) return;
    const ticks = Object.values(snapshot.series).flatMap((points) => (points ?? []).map((x) => x.t));
    const next = oddsSchedule(ticks, clock, Date.now())[1];
    if (next == null) return;
    const timer = setTimeout(wake, Math.max(next - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [clock, snapshot, tick]);
  const until = clock ? clock.p(Date.now() / 1000) * 1000 : null;
  // A new snapshot only when a tick is presented (the chart glides on its version).
  const shown = until == null ? null : Object.values(snapshot.series).reduce((n, points) => n + (points ? shownUntil(points, until).length : 0), 0);
  return useMemo(() => {
    if (until == null) return snapshot;
    const series: { -readonly [K in keyof OddsSnapshot["series"]]: OddsSnapshot["series"][K] } = {};
    const current: Record<string, number> = {};
    let version = 0;
    for (const [outcome, points] of Object.entries(snapshot.series)) {
      if (!points) continue;
      const kept = shownUntil(points, until);
      series[outcome as keyof OddsSnapshot["series"]] = kept;
      const last = kept.at(-1);
      if (last) {
        current[outcome] = last.p;
        version += kept.length + last.t / 1e12;
      }
    }
    return { ...snapshot, series, current, version };
    // `until` is read as it is when a tick is presented (`shown` changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, shown, until == null]);
}

export function WinProbabilitySection({ game }: { game: GameContext }) {
  const enabled = useSettings((s) => s.odds);
  const { event, detail, names, spoken } = game;
  const possible = oddsPossible(game, enabled);
  const ref = event.ref?.kind === "espn" ? event.ref : null;
  const state: GameState = event.state === "live" ? "live" : event.state === "final" ? "final" : "scheduled";
  const basis = detail.odds;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;

  const oddsGame = useMemo((): OddsGame | null => {
    if (!possible || !ref || !top || !bottom) return null;
    const unique = (xs: readonly string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);
    return {
      id: event.id,
      path: ref.path,
      state,
      start: event.start,
      playStart: basis.start,
      playEnd: basis.end,
      names: { top: unique([top.name, ...basis.names.top]), bottom: unique([bottom.name, ...basis.names.bottom]) },
    };
  }, [possible, ref, top, bottom, event.id, event.start, state, basis.start, basis.end, basis.names]);

  // On screen or not (the feed debounces it: 0.25 s on, 2 s off), once there's a section to see.
  const section = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
  const { feed, snapshot: market } = useOddsFeed(oddsGame, onScreen);
  // Broadcasting: the market as it stood at p.
  const snapshot = usePresentedOdds(market, game.broadcast?.clock ?? null);
  const found = possible && snapshot.status === "ready" && snapshot.market != null;
  useEffect(() => {
    const el = section.current;
    if (!found || !el || typeof IntersectionObserver === "undefined") {
      setOnScreen(false);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry?.isIntersecting ?? false));
    io.observe(el);
    return () => io.disconnect();
  }, [found]);

  // The chart's chunk, on its way while the market is looked for.
  useEffect(() => {
    if (possible) void loadOddsSection();
  }, [possible]);

  const bar =
    detail.topWinProbability != null && event.state !== "final" ? (
      <DetailSection
        id="winProbability"
        title="Win Probability"
        caption={event.state === "scheduled" ? "ESPN's matchup predictor, before tip-off." : "ESPN's estimate of each team's chance to win, updated live."}
      >
        <WinProbability topShare={detail.topWinProbability} draw={detail.drawProbability} topName={names.top} bottomName={names.bottom} palette={game.palette} spokenTop={spoken.top} spokenBottom={spoken.bottom} />
      </DetailSection>
    ) : null;
  if (found) {
    return (
      <div ref={section}>
        <Suspense fallback={bar}>
          <OddsSection game={game} snapshot={snapshot} feed={feed} state={state} />
        </Suspense>
      </div>
    );
  }
  return bar;
}

