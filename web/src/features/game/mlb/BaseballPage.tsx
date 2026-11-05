/**
 * The MLB game page (DetailView.swift's baseball sections): At the Plate (the
 * diamond, the count, the matchup and the play theater), This At-Bat (the
 * strike zone and its pitches), the score by inning, win probability, the
 * series, scoring plays, balls in play and the latest plays, live from the
 * baseball fast lane every 5 seconds (data/liveFeeds/baseball.ts).
 *
 * The lane speaks once the first full load has named the box score's
 * players; until then the full load's situation, at-bat and theater stand in.
 *
 * While the page broadcasts (BROADCAST.md §3), the diamond is the fast lane's
 * situation recorded after the last told play, This At-Bat and Balls in Play
 * are the told pitches and results, and who's batting is the presented
 * half-inning; MLB's own pitch times place each pitch (data/broadcast/lanes.ts
 * `timed`). The play theater keeps today's inputs.
 */
import { Suspense, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { battingSide, Accessory, shortInning, type AccessoryTier } from "../../../data/matchRules";
import type { Baseball, BattedBall } from "../../../data/gameDetail";
import { espnTeamIDs, sideMapper } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { BaseballFeed } from "../../../data/liveFeeds/baseball";
import { theater as parseTheater, EMPTY_THEATER, type TheaterState } from "../../../data/mlb/playScene";
import { DetailSection } from "../core/DetailSection";
import { MiniBases, OutDots } from "../core/DockedScorebar";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { useCommonSections } from "../core/useCommonSections";
import { useReplaySync } from "../core/replay/useReplaySync";
import { BaseballDiamond } from "./BaseballDiamond";
import { SprayChart } from "./SprayChart";
import { StrikeZone } from "./StrikeZone";
import { espnPlayerRef } from "../../profiles/ProfileLinks";
import dock from "../core/DockedScorebar.module.css";
import diamond from "./BaseballDiamond.module.css";
import { feedBroadcast } from "../core/broadcast";
import { isInterval } from "../../../data/broadcast/presentedGame";
import { DiamondTheater } from "./theater/DiamondTheater";


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
    shownRuns.current = runsShown(game.raw.event);
    // The broadcast's lanes: the situation after the play it follows, the look at the plays (a tail of the game), the status.
    await feedBroadcast(game.model, feed, async () => {
      await feed.update(getJSON, { path: ref.path, eventID: ref.id, names: detail.athleteNames, side, signal });
      if (feed.situation) game.model.observeSituation(feed.situation, feed.situationPlay);
    });
    game.moments.retract(feed.takeRetractions());
    game.moments.offer(feed.takeMoments());
    // A score: refresh the rest (scoring list, line score) now, not in half a minute. On the first
    // look, a lane already ahead of the page's numbers counts as one.
    const after = feed.score;
    if (!after) return;
    const changed = before ? before.home !== after.home || before.away !== after.away : after.home + after.away > shownRuns.current;
    if (changed) game.refresh();
  });

  // The diamond from the lane when it has spoken, else the last full load: today's, which the theater keeps.
  const today: Baseball | null = useMemo(() => {
    const s = feed.situation;
    const d = game.raw.detail.baseball;
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
  }, [feed.situation, game.raw.detail.baseball]);
  // Broadcasting: the diamond after the last told play (the presented detail's).
  const broadcast = game.broadcast;
  const situation: Baseball | null = broadcast ? detail.baseball : today;

  // Today's inning (the theater's), and the presented one while broadcasting ("Top 7th").
  const todayInning = feed.inning ?? game.raw.event.detail;
  const inning = broadcast ? event.detail : todayInning;
  const batting = live ? battingSide(inning, detail.topIsHome) : null;
  const pitches = broadcast ? detail.atBat : feed.loaded ? feed.atBat : detail.atBat;
  // Every ball in play: the full load's, plus any the lane has seen since (broadcasting: the told ones).
  const balls: readonly BattedBall[] = useMemo(() => {
    if (broadcast) return detail.battedBalls;
    const known = new Set(detail.battedBalls.map((b) => b.id));
    return [...detail.battedBalls, ...feed.battedBalls.filter((b) => !known.has(b.id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcast, detail.battedBalls, feed.battedBalls]);

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

  // The rows' replays, built from the summary's plays (MLB's account joined where it has the play).
  useReplaySync(game);
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
            {/* Broadcasting, the theater on the engine reads the broadcast; otherwise today's keeps the lane's diamond and inning. */}
            <DiamondTheater
              state={theater}
              bases={[(today ?? situation).onFirst, (today ?? situation).onSecond, (today ?? situation).onThird]}
              batting={live ? battingSide(todayInning, game.raw.detail.topIsHome) : null}
              palette={palette}
              kits={kits}
              event={game.raw.event}
              plays={feed.plays}
              playsVersion={feed.playsVersion}
              names={detail.athleteNames}
              heard={feed.heard}
              following={feed.following}
              delay={feed.delay}
              situation={today ?? situation}
              inning={todayInning}
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
    clockFallback: broadcast ? (event.detail ?? "Live") : (feed.inning ?? (event.detail?.toUpperCase() === "HT" ? "Half-time" : (event.detail ?? "Live"))),
    heroSecond: battingTeam ? `${battingTeam.abbreviation} batting` : null,
    heroSpoken: battingTeam ? `${battingTeam.name} batting` : null,
    // Between innings the bar keeps no diamond (BROADCAST: one phase for every surface).
    dockDetail: situation && !(broadcast && isInterval(broadcast.presented))
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
  };
}

/** The runs the page shows now (the scoreboard's, or the summary's). */
function runsShown(event: GameContext["event"]): number {
  return event.content.kind === "match" ? (Number(event.content.top.score) || 0) + (Number(event.content.bottom.score) || 0) : 0;
}

/** The bar's inning in two characters ("▲7"). */
export const barInning = (inning: string | null) => shortInning(inning);
