/**
 * The soccer game page (DetailView.swift's soccer sections): the live pitch
 * (the last 10 actions trailing to the ball) or, after, the shot map; the
 * timeline of goals and cards; win probability with the draw; team stats;
 * the league table re-ranked live; key events (scorers and assists linking
 * to their pages); ESPN's commentary; where to watch. Live from the soccer
 * lane every 8 seconds (data/liveFeeds/soccer.ts), whose goals, chances and
 * cards play on the pitch; a goal or a card brings the timeline and key
 * events along at once. The docked bar shows each side's red cards; a
 * knockout tie's leg, aggregate and shootout sit under the hero's status.
 *
 * Every league the app has (the Premier League, the Champions and Europa
 * Leagues, LaLiga, Serie A, the Bundesliga, Ligue 1, the Championship, MLS,
 * the World Cup) reads the same feeds.
 *
 * Live, the play theater (theater/, SoccerTheater.swift) replays each big
 * moment at the top of the Live Pitch from the lane's window of core plays.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { espnTeamIDs } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { leagueWithID } from "../../../data/leagues";
import { SoccerFeed, soccerMinute } from "../../../data/liveFeeds/soccer";
import { Accessory, type AccessoryTier } from "../../../data/matchRules";
import type { Side } from "../../../data/models";
import type { Section } from "../../../data/sections";
import { tieLine } from "../../../data/soccer";
import { withLaneScore } from "../../../data/standings";
import { espnPlayerRef } from "../../profiles/ProfileLinks";
import { shortened } from "../../../data/moments";
import { headline } from "../core/CommonSections";
import { DetailSection } from "../core/DetailSection";
import type { PeekSource } from "../core/peek";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { useCommonSections } from "../core/useCommonSections";
import { SoccerTableWindow, useLeagueLive, useTableRows } from "../tables/GameTables";
import { Pitch } from "./Pitch";
import { PitchTheater } from "./theater/PitchTheater";
import { Timeline } from "./Timeline";
import { soccerMomentText } from "./MomentText";
import styles from "./SoccerPage.module.css";

export function useSoccerPage(game: GameContext): SportPage {
  const { event, detail, palette, names, spoken, live } = game;
  const ref = event.ref?.kind === "espn" ? event.ref : null;
  const slug = ref?.path.split("/").pop() ?? null;

  // The lane, one per page: the match's positioned plays, then only what's new.
  const feedRef = useRef<SoccerFeed | null>(null);
  feedRef.current ??= new SoccerFeed();
  const feed = feedRef.current;
  useSyncExternalStore(feed.subscribe, () => feed.version, () => 0);
  // Soccer lists the home side first: the top team is at home.
  const [homeID] = espnTeamIDs(event);
  const look = async (signal?: AbortSignal) => {
    if (!ref || !slug) return;
    await feed.update(getJSON, { league: slug, eventID: ref.id, homeTeamID: homeID, rosters: detail.soccerRosters, signal });
    // A goal VAR struck off goes before anything new shows.
    const struck = feed.takeRetractions();
    game.moments.retract(struck);
    const fresh = feed.takeMoments();
    game.moments.offer(fresh);
    // A goal or a card: bring the timeline and key events along now, not in half a minute (and a goal struck off,
    // so the timeline and the score drop it: a web addition).
    if (struck.length > 0 || fresh.some((m) => m.kind === "goal" || m.kind === "yellowCard" || m.kind === "redCard")) game.refresh();
  };
  // A finished match's shot map: one load. Live, the fast lane takes over.
  const started = event.state !== "scheduled";
  useEffect(() => {
    if (!started || live) return;
    const controller = new AbortController();
    void look(controller.signal).catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, live, ref?.id]);
  useFastLane(live && ref != null, LANE_INTERVAL.soccer, (signal) => look(signal));

  const playerRef = useMemo(() => (id: string, name: string) => espnPlayerRef(ref?.path ?? "soccer/all", id, name), [ref?.path]);
  const momentText = useMemo(() => soccerMomentText(playerRef), [playerRef]);
  const common = useCommonSections(game, { momentText });
  const sectionWidth = game.split ? 320 : 380;

  // The league's table, re-ranked live.
  const league = slug ? leagueWithID(slug) : undefined;
  const tableRows = useTableRows(league?.sport === "soccer" ? league : undefined);
  const leagueLive = useLeagueLive(league);
  const ids = useMemo(() => (event.content.kind === "match" ? [event.content.top.id, event.content.bottom.id].filter((x): x is string => x != null) : []), [event.content]);

  const sections: Partial<Record<Section, ReactNode>> = { ...common };
  // The charts, shared by their sections and the chart peek (the same element, so the peek is the same chart).
  const pitchChart = <Pitch trail={feed.trail} shots={feed.shots} cards={feed.cards} live={live} palette={palette} topName={names.top} bottomName={names.bottom} spokenTop={spoken.top} spokenBottom={spoken.bottom} width={sectionWidth} theaterShown={live} />;
  const minute = live ? soccerMinute(event.detail) : null;
  const timelineChart = <Timeline moments={detail.moments} currentMinute={minute} palette={palette} topName={names.top} bottomName={names.bottom} width={sectionWidth} />;
  if (live ? feed.trail.length > 0 : feed.shots.length > 0) {
    sections.pitch = (
      <DetailSection
        id="pitch"
        title={live ? "Live Pitch" : "Shot Map"}
        caption={live ? `The last 10 actions, live. ${names.top} attacks →` : `Every shot, with each goal's path. ${names.top} attacks →, ${names.bottom} ←`}
        spokenCaption={`${live ? "The last 10 actions, live. " : "Every shot, with each goal's path. "}${spoken.top} attacking left to right, ${spoken.bottom} right to left.`}
        accessory={live ? "live" : event.state === "final" ? "final" : undefined}
      >
        {/* The play theater at the top of the Live Pitch, as on the Mac; it owns the moments it replays (GoalCelebration.pitchBursts). */}
        {live ? <PitchTheater feed={feed} homeTeamID={homeID} event={event} /> : null}
        {pitchChart}
      </DetailSection>
    );
  }
  if (detail.moments.some((m) => m.minute != null) || live) {
    sections.timeline = (
      <DetailSection
        id="timeline"
        title="Timeline"
        caption={`Goals and cards by minute. ${names.top} above, ${names.bottom} below.${live ? " The red dot marks now." : ""}`}
        spokenCaption={`Goals and cards by minute. ${spoken.top} above, ${spoken.bottom} below.`}
      >
        {timelineChart}
      </DetailSection>
    );
  }
  // The lane's score while it's ahead of the scoreboard (never behind it), so the hero and the pitch tell a goal together.
  const laneScores = useMemo(() => {
    if (!live || !feed.score || event.content.kind !== "match") return null;
    const known = (Number(event.content.top.score) || 0) + (Number(event.content.bottom.score) || 0);
    return feed.score.top + feed.score.bottom > known ? { top: String(feed.score.top), bottom: String(feed.score.bottom) } : null;
  }, [live, feed.score, event.content]);
  // The projected table counts it too, so the table and the hero agree once the goal lands.
  const tableLive = useMemo(() => withLaneScore(leagueLive, event.id, laneScores), [leagueLive, event.id, laneScores]);
  if (league && tableRows && detail.seasonIsCurrent !== false) {
    sections.table = <SoccerTableWindow league={league} rows={tableRows} live={tableLive} ids={ids} final={event.state === "final"} recent={event.start > Date.now() - 86_400_000} width={game.split ? 320 : 380} />;
  }

  // Red cards beside each side's name on the docked bar (a count where there's room, or for two and more).
  const reds = useMemo(() => {
    const list = detail.moments.filter((m) => m.kind === "red");
    return { top: list.filter((m) => m.side === "top").length, bottom: list.filter((m) => m.side === "bottom").length };
  }, [detail.moments]);
  const dockSlot =
    live && (reds.top > 0 || reds.bottom > 0)
      ? (side: Side, tier: AccessoryTier) => {
          const count = reds[side];
          if (count === 0 || tier < Accessory.glyph) return null;
          const shown = tier >= Accessory.full ? count : count > 1 ? count : 0;
          return (
            <span className={styles.redCard} title={`${count} red ${count === 1 ? "card" : "cards"}`}>
              <span className={styles.card} />
              {shown > 0 ? <span className={styles.count}>{shown}</span> : null}
            </span>
          );
        }
      : undefined;

  // The chart peek (LinkedPeek): a key event lights its shot on the pitch, else its mark on the timeline.
  const peek: PeekSource = {
    inputs: {
      pitch: [...(live ? feed.trail : []), ...feed.shots, ...Object.entries(feed.cards).map(([id, a]) => ({ ...a, playID: id }))].map((a) => ({ id: a.playID, side: a.side, lead: a.minute, detail: shortened(a.text) })),
      timeline: detail.moments.filter((m) => m.minute != null && m.kind !== "other" && m.kind !== "score").map((m) => ({ id: m.id, side: m.side, lead: m.clock, detail: headline(m) })),
    },
    chart: (section) => (section === "pitch" ? pitchChart : section === "timeline" ? timelineChart : null),
    aspect: { pitch: 105 / 68 },
  };

  return {
    sections,
    laneScores,
    clockFallback: event.detail?.toUpperCase() === "HT" ? "Half-time" : (event.detail ?? "Live"),
    heroNote: tieLine(detail.soccerTie),
    dockSlot,
    peek,
  };
}
