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
 * line. A final's header is where it began, at the start of play.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { GameState } from "../../../../data/odds/chart";
import { seriesFor } from "../../../../data/odds/polymarket";
import { useOddsFeed, type OddsGame } from "../../../../state/odds";
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
  const { feed, snapshot } = useOddsFeed(oddsGame, onScreen);
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

