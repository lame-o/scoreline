/**
 * The NBA game page (DetailView.swift's NBA sections; Basketball*.swift): the
 * shot chart with its live trail and replay, game flow, the score by quarter
 * (the live lane's points in it), leaders, key plays, the box score, team
 * stats, win probability, the latest plays, the conference standings with
 * seeds, the injury report, where to watch; the CLUTCH chip; the ball by the
 * team that has it, in the hero and on the docked bar. Live from the NBA's
 * fast lane every 5 seconds (data/liveFeeds/basketball.ts), whose moments
 * play the court's shot stories and the swish, rim and embers at the rim.
 *
 * The WNBA gets the same page with what its data supports (10-minute
 * quarters; no standings or player pages in Scoreline).
 *
 * One `NBAStage` per page carries the replay and the picked player to the
 * court, the flow, the leaders and the box score.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { elapsed as gameElapsed, leaderNames, boxPlayers, mergeFlow, mergePlays, mergeShots, NBA_PATH, quarterLength, type Basketball } from "../../../data/basketball";
import { espnTeamIDs } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { leagueWithID } from "../../../data/leagues";
import { BasketballFeed, runLabel, type Teams } from "../../../data/liveFeeds/basketball";
import type { GameClock, Side } from "../../../data/models";
import type { Section } from "../../../data/sections";
import { useIsFollowing } from "../../../state/settings";
import { espnPlayerRef } from "../../profiles/ProfileLinks";
import { DetailSection } from "../core/DetailSection";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { useCommonSections } from "../core/useCommonSections";
import { NBATableWindow, useLeagueLive, useTableRows } from "../tables/GameTables";
import { Court } from "./Court";
import { GameFlow } from "./GameFlow";
import { BoxScore, InjuryReport, Leaders } from "./Players";
import { NBAStage, StageProvider } from "./stage";

/** Game seconds played, from the scoreboard's clock (until the live lane reads its own). */
function clockElapsed(clock: GameClock | null, quarter: number): number | null {
  if (!clock) return null;
  const left = Math.max(0, Math.round(clock.seconds));
  return gameElapsed(clock.period, `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, quarter);
}

export function useBasketballPage(game: GameContext): SportPage {
  const { event, detail, palette, names, spoken, live } = game;
  const ref = event.ref?.kind === "espn" ? event.ref : null;
  const path = ref?.path ?? NBA_PATH;
  const nbaLeague = path === NBA_PATH;
  const quarter = quarterLength(path);
  const nba: Basketball | null = detail.basketball;

  // The lane and the stage, one per page.
  const feedRef = useRef<BasketballFeed | null>(null);
  feedRef.current ??= new BasketballFeed();
  const feed = feedRef.current;
  useSyncExternalStore(feed.subscribe, () => feed.version, () => 0);
  const stageRef = useRef<NBAStage | null>(null);
  stageRef.current ??= new NBAStage();
  const stage = stageRef.current;
  useEffect(() => () => stage.dispose(), [stage]);
  // Esc drops a picked player before anything else (DetailView.back).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !stage.unpin()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [stage]);

  const [topID, bottomID] = espnTeamIDs(event);
  const teams: Teams | null = useMemo(
    () => (detail.topIsHome == null ? null : { topIsHome: detail.topIsHome, topID, bottomID, topName: names.top, bottomName: names.bottom }),
    [detail.topIsHome, topID, bottomID, names.top, names.bottom],
  );
  // Wait for the first full load: it says which team is home.
  useFastLane(live && ref != null && teams != null, LANE_INTERVAL.standard, async (signal) => {
    if (!ref || !teams) return;
    await feed.update(getJSON, { path: ref.path, eventID: ref.id, teams, signal });
    game.moments.retract(feed.takeRetractions());
    game.moments.offer(feed.takeMoments());
  });

  const lane = live && feed.loaded;
  const shots = useMemo(() => (nba ? (lane ? mergeShots(nba.shots, nba.newestElapsed, feed.shots) : nba.shots) : []), [nba, lane, feed.shots]);
  const plays = useMemo(() => (nba ? (lane ? mergePlays(nba.plays, feed.plays) : nba.plays) : []), [nba, lane, feed.plays]);
  const flow = useMemo(() => (nba ? mergeFlow(nba.flow, lane ? feed.flow : []) : []), [nba, lane, feed.flow]);
  const players = useMemo(() => (nba ? boxPlayers(nba) : new Map()), [nba]);
  const extraNames = useMemo(() => (nba ? leaderNames(nba) : {}), [nba]);
  const now = live ? (feed.elapsed ?? clockElapsed(event.clock, quarter)) : null;
  const streaks = live && feed.playing ? feed.streaks : NO_STREAKS;
  const runs = live && feed.playing ? feed.runs : NO_RUNS;
  const playerRef = useMemo(() => (id: string, name: string) => espnPlayerRef(path, id, name), [path]);

  // The score by quarter with the lane's points in it, so T matches the hero.
  const linescore = useMemo(
    () => (detail.linescore && live && detail.topIsHome != null ? feed.linescore(detail.linescore, detail.topIsHome) : detail.linescore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail.linescore, live, detail.topIsHome, feed.score, feed.period, feed.playing],
  );
  const common = useCommonSections(linescore === detail.linescore ? game : { ...game, detail: { ...detail, linescore } }, {
    // The live lane is a step ahead of the full refresh.
    plays: live && feed.recentPlays.length > 0 ? feed.recentPlays : detail.recentPlays,
  });

  // Standings (the NBA's; the WNBA has none in Scoreline).
  const league = nbaLeague ? leagueWithID("nba") : undefined;
  const tableRows = useTableRows(league);
  const leagueLive = useLeagueLive(league);
  const ids = useMemo(() => (event.content.kind === "match" ? [event.content.top.id, event.content.bottom.id].filter((x): x is string => x != null) : []), [event.content]);

  const followTop = useIsFollowing(event.content.kind === "match" ? event.content.top.id : null);
  const followBottom = useIsFollowing(event.content.kind === "match" ? event.content.bottom.id : null);
  const sectionWidth = game.split ? 320 : 380;

  // The charts, shared by their sections and the chart peek.
  const courtChart = (
    <Court
      shots={shots}
      plays={plays}
      palette={palette}
      topName={names.top}
      bottomName={names.bottom}
      spokenTop={spoken.top}
      spokenBottom={spoken.bottom}
      players={players}
      names={extraNames}
      live={live}
      now={now}
      quarter={quarter}
      streaks={streaks}
      runs={runs}
      playerRef={playerRef}
      width={sectionWidth}
    />
  );
  const flowChart = <GameFlow flow={flow} palette={palette} topName={names.top} bottomName={names.bottom} spokenTop={spoken.top} spokenBottom={spoken.bottom} now={now} final={event.state === "final"} quarter={quarter} runs={runs} width={sectionWidth} />;
  const sections: Partial<Record<Section, ReactNode>> = { ...common };
  if (nba && (nba.shots.length > 0 || live)) {
    const lead = live ? "The last plays trail to the ball." : "Every shot. Play to replay the game.";
    sections.court = (
      <DetailSection
        id="court"
        title="Shot Chart"
        caption={`${lead} ${names.top} shoots →, ${names.bottom} ←.`}
        spokenCaption={`${lead} ${spoken.top} at the right basket, ${spoken.bottom} at the left.`}
        accessory={live ? "live" : event.state === "final" ? "final" : undefined}
      >
        {courtChart}
      </DetailSection>
    );
  }
  if (nba && (flow.length > 1 || live)) {
    sections.flow = (
      <DetailSection
        id="flow"
        title="Game Flow"
        caption={`The margin through the game. ${names.top} ahead above, ${names.bottom} below.`}
        spokenCaption={`The margin through the game. ${spoken.top} ahead above, ${spoken.bottom} below.`}
      >
        {flowChart}
      </DetailSection>
    );
  }
  if (nba && nba.leaders.length > 0) {
    sections.leaders = (
      <DetailSection id="leaders" title={nba.seasonLeaders ? "Season Leaders" : "Leaders"} caption={nba.seasonLeaders ? "Per-game averages this season." : live ? "This game so far." : "This game."}>
        <Leaders lines={nba.leaders} streaks={streaks} playerRef={playerRef} path={path} />
      </DetailSection>
    );
  }
  if (nba && (nba.topBox.length > 0 || nba.bottomBox.length > 0)) {
    sections.box = (
      <DetailSection
        id="box"
        title="Box Score"
        caption={`${live ? "A dot marks the five on court. " : "Starters, then the bench. "}${nbaLeague ? "Click a player for their shots, their name for their page." : "Click a player to see only their shots."}`}
        accessory={live ? "live" : event.state === "final" ? "final" : undefined}
      >
        <BoxScore
          top={nba.topBox}
          bottom={nba.bottomBox}
          topName={names.top}
          bottomName={names.bottom}
          topTotals={nba.topTotals}
          bottomTotals={nba.bottomTotals}
          live={live}
          initial={followTop !== followBottom ? (followTop ? "top" : "bottom") : "top"}
          streaks={streaks}
          playerRef={playerRef}
        />
      </DetailSection>
    );
  }
  // ESPN's report is today's, even on an old game's page: not after the final.
  if (nba && nba.injuries.length > 0 && event.state !== "final") {
    sections.injuries = (
      <DetailSection id="injuries" title="Injury Report" caption="ESPN's latest report.">
        <InjuryReport injuries={nba.injuries} top={event.content.kind === "match" ? event.content.top : null} bottom={event.content.kind === "match" ? event.content.bottom : null} leagueID={game.leagueID} playerRef={playerRef} />
      </DetailSection>
    );
  }
  if (tableRows && detail.seasonIsCurrent !== false && tableRows.some((r) => ids.includes(r.id))) {
    sections.table = <NBATableWindow rows={tableRows} live={leagueLive} ids={ids} />;
  }
  // Every section reads the page's stage.
  for (const key of Object.keys(sections) as Section[]) {
    const node = sections[key];
    if (node != null) sections[key] = <StageProvider value={stage}>{node}</StageProvider>;
  }

  // The lane's score, while it's ahead of the scoreboard (never behind it).
  const laneScores = useMemo(() => {
    if (!live || detail.topIsHome == null || !feed.score || event.content.kind !== "match") return null;
    const known = (Number(event.content.top.score) || 0) + (Number(event.content.bottom.score) || 0);
    if (feed.score.home + feed.score.away < known) return null;
    return detail.topIsHome ? { top: String(feed.score.home), bottom: String(feed.score.away) } : { top: String(feed.score.away), bottom: String(feed.score.home) };
  }, [live, detail.topIsHome, feed.score, event.content]);

  const playing = live && feed.playing;
  const clutch = playing && feed.clutch;
  const run = playing ? (feed.runs[0] ?? null) : null;
  const possession = playing ? feed.possession : null;
  const inAir = playing && feed.ballInAir;
  const team = (side: Side) => (event.content.kind === "match" ? (side === "top" ? event.content.top : event.content.bottom) : null);
  return {
    sections,
    laneScores,
    clockFallback: feed.clock ?? (event.detail?.toUpperCase() === "HT" ? "Half-time" : (event.detail ?? "Live")),
    clock: playing ? feed.gameClock : null,
    possession,
    possessionInAir: inAir,
    heroSpoken: possession ? `${team(possession)?.name ?? ""} ball` : null,
    heroChip: clutch ? "CLUTCH" : null,
    // One chip at a time, by priority: CLUTCH, then a run (DockRules.chip).
    chip: clutch ? "CLUTCH" : run ? runLabel(run) : null,
    // The chart peek (LinkedPeek): a key play, a quarter or a player lights their shots on the court, else the game flow.
    peek: nba
      ? {
          inputs: {
            shots: shots.map((x) => ({ id: x.id, period: x.period, side: x.side, player: x.player, lead: `${x.made ? "Made" : "Missed"} ${x.value}`, detail: x.text })),
            flow: flow.map((p) => ({
              id: p.id,
              period: p.period,
              side: p.scorer,
              lead: p.top === p.bottom ? `Tied ${p.top}–${p.bottom}` : p.top > p.bottom ? `${names.top} ${p.top}–${p.bottom}` : `${names.bottom} ${p.bottom}–${p.top}`,
              detail: p.clock,
            })),
            names: { ...extraNames, ...Object.fromEntries([...players].map(([id, box]) => [id, box.name])) },
          },
          chart: (section) => (section === "court" ? <StageProvider value={stage}>{courtChart}</StageProvider> : section === "flow" ? <StageProvider value={stage}>{flowChart}</StageProvider> : null),
          aspect: { court: 94 / 50 },
          picked: { get: () => stage.get().pinned, subscribe: stage.subscribe, pick: (player) => stage.togglePin(player), unpin: () => stage.unpin() },
        }
      : null,
  };
}

const NO_STREAKS: Readonly<Record<string, number>> = {};
const NO_RUNS: readonly never[] = [];
