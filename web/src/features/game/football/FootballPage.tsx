/**
 * The NFL and college football game page (DetailView.swift's football
 * sections): the Field (the drive snap by snap, the line of scrimmage, the
 * line to gain, the red zone, who has the ball, the RED ZONE and 2-MIN DRILL
 * chips, timeouts, and the drive list), the score by quarter (its cells light
 * the scoring plays they hold), win probability, scoring plays, team stats,
 * the conference table with AP ranks (college), and where to watch, live
 * from the football fast lane every 5 seconds (data/liveFeeds/football.ts).
 *
 * The lane waits for the first full load (it says which team is home); until
 * it has spoken, the scoreboard's situation stands in. The lane's clock runs
 * the hero's and the docked bar's (its 5-second readings tick only while the
 * clock really runs), and the bar shows the down and distance (red in the red
 * zone), the ball beside the team that has it, and 2-MIN DRILL.
 */
import { useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "../../../design/components";
import { apRanks } from "../../../data/college";
import type { DetailMoment, Football } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { leagueWithID } from "../../../data/leagues";
import { FootballFeed, twoMinuteDrill, type FootballTeams } from "../../../data/liveFeeds/football";
import { Accessory, downAndSpot, type AccessoryTier } from "../../../data/matchRules";
import type { ScoreEvent, Side } from "../../../data/models";
import { rankingsPath, standingsPath } from "../../../data/schedule";
import { useRankings, useStandings } from "../../../state/standings";
import { DetailSection } from "../core/DetailSection";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { useCommonSections } from "../core/useCommonSections";
import { CollegeTable } from "./ConferenceTable";
import { FootballField } from "./FootballField";
import { useNameLinker } from "./names";
import styles from "./FootballPage.module.css";

export function useFootballPage(game: GameContext): SportPage {
  const { event, detail, palette, live } = game;
  const ref = event.ref?.kind === "espn" ? event.ref : null;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  // Stable for the memoized charts (the context's objects are new on every render).
  const names = useMemo(() => ({ top: game.names.top, bottom: game.names.bottom }), [game.names.top, game.names.bottom]);
  const spoken = useMemo(() => ({ top: game.spoken.top, bottom: game.spoken.bottom }), [game.spoken.top, game.spoken.bottom]);

  // The lane, one per page.
  const feedRef = useRef<FootballFeed | null>(null);
  feedRef.current ??= new FootballFeed();
  const feed = feedRef.current;
  useSyncExternalStore(feed.subscribe, () => feed.version, () => 0);

  // Wait for the first full load: it says which team is home.
  const topIsHome = detail.topIsHome;
  const teams: FootballTeams | null = useMemo(() => {
    if (topIsHome == null || !top || !bottom) return null;
    const id = (c: { id: string | null }) => c.id?.split("-").pop() ?? null;
    return {
      topIsHome,
      topID: id(top),
      bottomID: id(bottom),
      homeAbbreviation: topIsHome ? top.abbreviation : bottom.abbreviation,
      awayAbbreviation: topIsHome ? bottom.abbreviation : top.abbreviation,
    };
  }, [topIsHome, top, bottom]);

  useFastLane(live && ref != null && teams != null, LANE_INTERVAL.standard, async (signal) => {
    if (!ref || !teams) return;
    const before = feed.score;
    const shown = pointsShown(event);
    await feed.update(getJSON, { path: ref.path, eventID: ref.id, teams, signal });
    game.moments.retract(feed.takeRetractions());
    game.moments.offer(feed.takeMoments());
    // A score: refresh the rest (the scoring list, the stats) now, not in half a minute. On the
    // first look, a lane already ahead of the page's numbers counts as one.
    const after = feed.score;
    if (!after) return;
    const changed = before ? before.home !== after.home || before.away !== after.away : after.home + after.away > shown;
    if (changed) game.refresh();
  });

  // The lane's situation when it has spoken, else the scoreboard's (via the full load).
  const situation: Football | null = live ? (feed.situation ?? detail.football) : null;
  // Who has the ball: the lane first, then the situation, then the scoreboard.
  const possession: Side | null = live ? (feed.possession ?? situation?.possession ?? boardPossession(event)) : null;

  // The lane's score, while it's ahead of the scoreboard (never behind it).
  const laneScores = useMemo(() => {
    if (!live || topIsHome == null || !feed.score || !top || !bottom) return null;
    const known = (Number(top.score) || 0) + (Number(bottom.score) || 0);
    if (feed.score.home + feed.score.away < known) return null;
    return topIsHome ? { top: String(feed.score.home), bottom: String(feed.score.away) } : { top: String(feed.score.away), bottom: String(feed.score.home) };
  }, [live, topIsHome, feed.score, top, bottom]);

  // Late and one score down with the ball: the 2-MIN DRILL (from the lane's clock, else the scoreboard's).
  const clock = live ? (feed.gameClock ?? event.clock) : null;
  const scoreTop = Number(laneScores?.top ?? top?.score);
  const scoreBottom = Number(laneScores?.bottom ?? bottom?.score);
  const drill = clock != null && Number.isFinite(scoreTop) && Number.isFinite(scoreBottom) && twoMinuteDrill(clock.period, clock.seconds, possession, scoreTop, scoreBottom);

  // Players' names in the plays and scoring plays open their pages.
  const linkText = useNameLinker(detail.playerNames, ref?.path ?? null);
  const momentText = useMemo(() => (_: DetailMoment, text: string) => linkText(text), [linkText]);

  const sections: Partial<Record<string, ReactNode>> = { ...useCommonSections(game, { momentText }) };

  if (live && situation) {
    sections.field = (
      <DetailSection
        id="field"
        title="Field"
        caption={`This drive, snap by snap. ${names.top} defends the left end zone.`}
        spokenCaption={`This drive, snap by snap. ${spoken.top} defending the left end zone.`}
        accessory="live"
      >
        <FootballField situation={situation} plays={feed.plays} names={names} spoken={spoken} palette={palette} possession={possession} twoMinuteDrill={drill} linkText={linkText} />
      </DetailSection>
    );
  }
  // TODO(football theater): the Mac's play theater (an isometric per-play replay, like MLB's) is
  // landing on the Mac separately. Port it as `sections.theater`: its slot is in the plan under the
  // field (data/sections.ts), in one column and in the left column of two.

  // College: the conference table with AP ranks, and the polls and full standings a click away.
  // Today's table says nothing about a game from another season.
  const college = ref?.path.endsWith("college-football") ? leagueWithID("college-football") : undefined;
  const standings = useStandings(college);
  const polls = useRankings(college && college.source.kind === "espn" ? college.source.path : null);
  const ranks = useMemo(() => apRanks(polls.data ?? []), [polls.data]);
  const ids = useMemo(() => [top?.id ?? null, bottom?.id ?? null], [top?.id, bottom?.id]);
  const rows = standings.data;
  if (college && rows && detail.seasonIsCurrent !== false && rows.some((r) => ids.includes(r.id))) {
    sections.table = (
      <DetailSection id="table" title="Conference" caption="Ranked by conference record; season record alongside.">
        <CollegeTable rows={rows} ids={ids} ranks={ranks} leagueID={college.id} />
        <div className={styles.links}>
          <Link className={styles.link} to={standingsPath(college.id, ids)} state={{ from: "Game" }}>
            Full Standings <Icon name="chevronRight" size={9} />
          </Link>
          <Link className={styles.link} to={rankingsPath(college.id)} state={{ from: "Game" }}>
            Top 25 <Icon name="chevronRight" size={9} />
          </Link>
        </div>
      </DetailSection>
    );
  }

  const ball = possession && top && bottom ? (possession === "top" ? top : bottom) : null;
  const split = downAndSpot(situation?.downDistance);
  return {
    sections,
    laneScores,
    clock: live ? feed.gameClock : null,
    clockFallback: live ? (feed.clock ?? (event.detail?.toUpperCase() === "HT" ? "Halftime" : (event.detail ?? "Live"))) : null,
    heroSpoken: ball ? `${ball.name} ball` : null,
    possession: live ? possession : undefined,
    dockDetail:
      live && split
        ? (tier: AccessoryTier) =>
            tier >= Accessory.text ? (
              <span className={styles.dockDown} data-red-zone={situation?.redZone === true}>
                {tier >= Accessory.full && split.spot ? `${split.down} ${split.spot}` : split.down}
              </span>
            ) : null
        : undefined,
    chip: drill ? "2-MIN DRILL" : null,
  };
}

/** The points the page shows now (the scoreboard's, or the summary's). */
function pointsShown(event: ScoreEvent): number {
  return event.content.kind === "match" ? (Number(event.content.top.score) || 0) + (Number(event.content.bottom.score) || 0) : 0;
}

/** The scoreboard's team with the ball (its competitor ID), as a side. */
function boardPossession(event: ScoreEvent): Side | null {
  if (!event.possession || event.content.kind !== "match") return null;
  return event.content.top.id === event.possession ? "top" : event.content.bottom.id === event.possession ? "bottom" : null;
}
