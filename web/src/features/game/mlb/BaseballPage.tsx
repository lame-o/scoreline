/**
 * The MLB game page (DetailView.swift's baseball sections): At the Plate (the
 * diamond, the count, the matchup and the play theater), This At-Bat (the
 * strike zone and its pitches), the score by inning, win probability, the
 * series, scoring plays, balls in play and the latest plays, live from the
 * baseball fast lane every 5 seconds (data/liveFeeds/baseball.ts).
 *
 * The lane speaks once the first full load has named the box score's
 * players; until then the full load's situation, at-bat and theater stand in.
 */
import { lazy, Suspense, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { battingSide, Accessory, shortInning, type AccessoryTier } from "../../../data/matchRules";
import type { Baseball, BattedBall } from "../../../data/gameDetail";
import { espnTeamIDs, sideMapper } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { BaseballFeed } from "../../../data/liveFeeds/baseball";
import { theater as parseTheater, EMPTY_THEATER, type TheaterState } from "../../../data/mlb/playScene";
import { DetailSection } from "../core/DetailSection";
import { MiniBases, OutDots } from "../core/DockedScorebar";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { linescoreChart, linescorePeek, useCommonSections } from "../core/useCommonSections";
import { BaseballDiamond } from "./BaseballDiamond";
import { SprayChart } from "./SprayChart";
import { StrikeZone } from "./StrikeZone";
import { espnPlayerRef } from "../../profiles/ProfileLinks";
import dock from "../core/DockedScorebar.module.css";
import diamond from "./BaseballDiamond.module.css";

/** The theater's renderer loads with the first live MLB page (its well holds the space meanwhile). */
const PlayTheater = lazy(() => import("./theater/PlayTheater").then((m) => ({ default: m.PlayTheater })));

export function useBaseballPage(game: GameContext): SportPage {
  const { event, detail, palette, names, spoken, live } = game;
  const ref = event.ref?.kind === "espn" ? event.ref : null;

  // The lane, one per page (its theater parser injected).
  const feedRef = useRef<BaseballFeed<TheaterState> | null>(null);
  if (!feedRef.current) feedRef.current = new BaseballFeed<TheaterState>(parseTheater);
  const feed = feedRef.current;
  const version = useSyncExternalStore(
    feed.subscribe,
    () => `${feed.situation ? JSON.stringify(feed.situation) : ""}|${feed.inning}|${feed.atBat.length}|${feed.atBat.at(-1)?.id}|${feed.battedBalls.length}|${feed.theater?.play?.id}|${feed.theater?.news}|${feed.score?.home}-${feed.score?.away}|${feed.loaded}|${feed.playsVersion}|${feed.heard}|${feed.delay?.kind}`,
    () => "",
  );
  void version;

  const side = useMemo(() => sideMapper(event), [event]);
  const shownRuns = useRef(0);
  const namesLoaded = Object.keys(detail.athleteNames).length > 0;
  useFastLane(live && ref != null && namesLoaded, LANE_INTERVAL.standard, async (signal) => {
    if (!ref) return;
    const before = feed.score;
    shownRuns.current = runsShown(event);
    await feed.update(getJSON, { path: ref.path, eventID: ref.id, names: detail.athleteNames, side, signal });
    game.moments.retract(feed.takeRetractions());
    game.moments.offer(feed.takeMoments());
    // A score: refresh the rest (scoring list, line score) now, not in half a minute. On the first
    // look, a lane already ahead of the page's numbers counts as one.
    const after = feed.score;
    if (!after) return;
    const changed = before ? before.home !== after.home || before.away !== after.away : after.home + after.away > shownRuns.current;
    if (changed) game.refresh();
  });

  // The diamond from the lane when it has spoken, else the last full load.
  const situation: Baseball | null = useMemo(() => {
    const s = feed.situation;
    const d = detail.baseball;
    if (!s) return d;
    return {
      ...s,
      batter: s.batter ?? d?.batter ?? null,
      pitcher: s.pitcher ?? d?.pitcher ?? null,
      lastPlay: s.lastPlay ?? d?.lastPlay ?? null,
      // An ID goes with the name shown: the lane's, or the full load's it fell back to.
      batterID: s.batter == null ? (d?.batterID ?? null) : s.batterID,
      pitcherID: s.pitcher == null ? (d?.pitcherID ?? null) : s.pitcherID,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.situation, detail.baseball]);

  const inning = feed.inning ?? event.detail;
  const batting = live ? battingSide(inning, detail.topIsHome) : null;
  const pitches = feed.loaded ? feed.atBat : detail.atBat;
  // Every ball in play: the full load's, plus any the lane has seen since.
  const balls: readonly BattedBall[] = useMemo(() => {
    const known = new Set(detail.battedBalls.map((b) => b.id));
    return [...detail.battedBalls, ...feed.battedBalls.filter((b) => !known.has(b.id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.battedBalls, feed.battedBalls]);

  // The theater: the lane's last play once it has one, else the full load's.
  const preloaded = useMemo(() => (detail.plays.length > 0 ? parseTheater(detail.plays, side, detail.athleteNames) : null), [detail.plays, side, detail.athleteNames]);
  const theater: TheaterState = (feed.loaded && feed.theater?.play ? feed.theater : null) ?? preloaded ?? feed.theater ?? EMPTY_THEATER;

  // The lane's score, while it's ahead of the scoreboard (never behind it).
  const laneScores = useMemo(() => {
    if (!live || detail.topIsHome == null || !feed.score || event.content.kind !== "match") return null;
    const known = (Number(event.content.top.score) || 0) + (Number(event.content.bottom.score) || 0);
    if (feed.score.home + feed.score.away < known) return null;
    return detail.topIsHome
      ? { top: String(feed.score.home), bottom: String(feed.score.away) }
      : { top: String(feed.score.away), bottom: String(feed.score.home) };
  }, [live, detail.topIsHome, feed.score, event.content]);

  const common = useCommonSections(game);
  const sections: Partial<Record<string, ReactNode>> = { ...common };
  const sectionWidth = game.split ? 320 : 380;
  const [topID, bottomID] = espnTeamIDs(event);
  void topID;
  void bottomID;
  const kits =
    event.content.kind === "match"
      ? {
          top: { color: event.content.top.color, alternate: event.content.top.alternateColor },
          bottom: { color: event.content.bottom.color, alternate: event.content.bottom.alternateColor },
        }
      : { top: { color: null, alternate: null }, bottom: { color: null, alternate: null } };

  if (live && situation) {
    sections.atPlate = (
      <DetailSection id="atPlate" title="At the Plate" caption="Live count, runners and matchup from ESPN." accessory="live">
        <BaseballDiamond situation={situation} batting={batting} palette={palette} player={(id, name) => espnPlayerRef("baseball/mlb", id, name)}>
          <Suspense fallback={<div className={diamond.theaterFallback} aria-hidden="true" />}>
            <PlayTheater
              state={theater}
              bases={[situation.onFirst, situation.onSecond, situation.onThird]}
              batting={batting}
              palette={palette}
              kits={kits}
              event={event}
              plays={feed.plays}
              playsVersion={feed.playsVersion}
              names={detail.athleteNames}
              heard={feed.heard}
              following={feed.following}
              delay={feed.delay}
              situation={situation}
              inning={inning}
              live={feed.loaded}
              topTeam={event.content.kind === "match" ? event.content.top.name : ""}
              bottomTeam={event.content.kind === "match" ? event.content.bottom.name : ""}
              people={detail.people}
              fielders={detail.fielders}
            />
          </Suspense>
        </BaseballDiamond>
      </DetailSection>
    );
  }
  // Stays up between batters ("Waiting for the first pitch"), so the page doesn't jump.
  if (live && (feed.loaded || pitches.length > 0)) {
    sections.atBat = (
      <DetailSection id="atBat" title="This At-Bat" accessory={situation ? { count: [situation.balls, situation.strikes] } : undefined}>
        <StrikeZone pitches={pitches} width={sectionWidth} />
      </DetailSection>
    );
  }
  // The chart, shared by its section and the chart peek.
  const sprayChart = (
    <SprayChart
      balls={balls}
      palette={palette}
      topName={names.top}
      bottomName={names.bottom}
      spokenTop={spoken.top}
      spokenBottom={spoken.bottom}
      celebrates={!(live && situation)}
      width={sectionWidth}
    />
  );
  if (balls.length > 0) {
    sections.battedBalls = (
      <DetailSection id="battedBalls" title="Balls in Play" caption="Every batted ball this game, colored by batting team.">
        {sprayChart}
      </DetailSection>
    );
  }

  const battingTeam = batting && event.content.kind === "match" ? (batting === "top" ? event.content.top : event.content.bottom) : null;
  return {
    sections,
    laneScores,
    clockFallback: feed.inning ?? (event.detail?.toUpperCase() === "HT" ? "Half-time" : (event.detail ?? "Live")),
    heroSecond: battingTeam ? `${battingTeam.abbreviation} batting` : null,
    heroSpoken: battingTeam ? `${battingTeam.name} batting` : null,
    dockDetail: situation
      ? (tier: AccessoryTier) =>
          tier >= Accessory.glyph ? (
            <span className={dock.baseball}>
              <MiniBases bases={[situation.onFirst, situation.onSecond, situation.onThird]} />
              <OutDots outs={situation.outs} />
              {tier >= Accessory.text ? <span className={dock.count}>{`${situation.balls}–${situation.strikes}`}</span> : null}
            </span>
          ) : null
      : undefined,
    chip: null,
    // The chart peek (LinkedPeek): a scoring play or an inning lights its balls in play, else its inning in the line score.
    peek: {
      inputs: {
        balls: balls.map((b) => ({ id: b.id, period: b.period, side: b.side, lead: OUTCOME[b.outcome], detail: b.text })),
        linescore: linescorePeek(game),
      },
      chart: (section) => (section === "battedBalls" ? sprayChart : section === "linescore" ? linescoreChart(game) : null),
      aspect: { battedBalls: 250 / 210 },
    },
  };
}

const OUTCOME: Readonly<Record<BattedBall["outcome"], string>> = { single: "Single", extraBases: "Extra bases", homeRun: "Home run", out: "Out" };

/** The runs the page shows now (the scoreboard's, or the summary's). */
function runsShown(event: GameContext["event"]): number {
  return event.content.kind === "match" ? (Number(event.content.top.score) || 0) + (Number(event.content.bottom.score) || 0) : 0;
}

/** The bar's inning in two characters ("▲7"). */
export const barInning = (inning: string | null) => shortInning(inning);
