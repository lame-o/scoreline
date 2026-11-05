/**
 * Win Probability, grown up (ODDS-SPEC.md "Where it lives", ODDS-DECISIONS.md
 * "The section"; OddsChart.swift `OddsSection`): Polymarket's market as a
 * line per outcome against ESPN's model and DraftKings' pregame line, in the
 * section's place in each sport's layout. Live and before the game it's "Win
 * Probability"; once over, "How the Odds Moved", the whole game's story.
 *
 * - Odds off (Settings), a league Polymarket doesn't list, or no confident
 *   match: ESPN's bar exactly as before (CommonSections.tsx `WinProbability`),
 *   or nothing where there was nothing.
 * - Which market is this game's is found as the page opens (one cached
 *   listing and one small request), since it decides whether the section
 *   shows at all; until then ESPN's bar stands in where there was one. The
 *   history, the socket and the polling follow only while the section is on
 *   screen (state/odds.ts): one market, one socket at most.
 * - The page holds the feed (useCommonSections), so the timeline shares its
 *   market's newest moment, and one pointer, so both read the same moment.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineMark } from "../../../../data/odds/marks";
import { seriesFor } from "../../../../data/odds/polymarket";
import type { OddsPointer } from "../../../../data/odds/pointer";
import { useOddsSelect, type OddsFeed, type OddsGame } from "../../../../state/odds";
import { WinProbability } from "../CommonSections";
import { DetailSection } from "../DetailSection";
import type { GameContext } from "../sport";
import type { PresentedTime } from "./inspection";

/** Whether this game could have odds at all: odds on, an ESPN match in a league Polymarket lists. */
export function oddsPossible(game: GameContext, enabled: boolean): boolean {
  const ref = game.event.ref;
  return enabled && ref?.kind === "espn" && seriesFor(ref.path) != null && game.event.content.kind === "match";
}

/** Whether the section has anything for this game: odds possible, or ESPN's bar (live and before the game, as before). */
export function hasWinProbability(game: GameContext, enabled: boolean): boolean {
  return oddsPossible(game, enabled) || (game.detail.topWinProbability != null && game.event.state !== "final");
}

/** What the page's odds feed knows about the game; null when odds aren't possible (no requests at all). */
export function useOddsGame(game: GameContext, enabled: boolean): OddsGame | null {
  const { event, detail } = game;
  const possible = oddsPossible(game, enabled);
  const ref = event.ref?.kind === "espn" ? event.ref : null;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const names = detail.odds.names;
  return useMemo((): OddsGame | null => {
    if (!possible || !ref || !top || !bottom) return null;
    const unique = (xs: readonly string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);
    return { id: event.id, path: ref.path, state: event.state, start: event.start, names: { top: unique([top.name, ...names.top]), bottom: unique([bottom.name, ...names.bottom]) } };
  }, [possible, ref, top, bottom, event.id, event.start, event.state, names]);
}

/** The section with the chart: its own chunk, fetched as the page starts looking for the market. */
const loadOddsSection = () => import("./OddsSection");
const OddsSection = lazy(() => loadOddsSection().then((m) => ({ default: m.OddsSection })));

export interface WinProbabilityProps {
  readonly game: GameContext;
  /** The page's odds feed (null: odds off, or no market possible). */
  readonly feed: OddsFeed | null;
  readonly time: PresentedTime;
  readonly pointer: OddsPointer;
  readonly marks: readonly TimelineMark[];
}

export function WinProbabilitySection({ game, feed, time, pointer, marks }: WinProbabilityProps) {
  const { event, detail, names, spoken } = game;
  const found = useOddsSelect(feed, (s) => s.status === "ready" && s.market != null);
  // Two sides that read apart in every sport: the game's colors, decided once (MatchColors), as the timeline's.
  const palette = game.palette;

  // On screen or not (the feed debounces it: 0.25 s on, 2 s off), once there's a section to see.
  const section = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(false);
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
  useEffect(() => {
    feed?.setOnScreen(onScreen);
  }, [feed, onScreen]);

  // The chart's chunk, on its way while the market is looked for.
  useEffect(() => {
    if (feed) void loadOddsSection();
  }, [feed]);

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
  if (found && feed) {
    return (
      <div ref={section}>
        <Suspense fallback={bar}>
          <OddsSection game={game} feed={feed} time={time} pointer={pointer} marks={marks} palette={palette} seen={onScreen} />
        </Suspense>
      </div>
    );
  }
  return bar;
}
