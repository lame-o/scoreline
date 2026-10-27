/**
 * The CS2 match page (DetailView.swift's counterStrike sections): Maps (the
 * veto's picks and each map's score), Rounds (round by round with the
 * economy, MAP POINT and MATCH POINT), Watch (bo3.gg's streams, official
 * first, and the co-streamer when bo3.gg lists their channel), Tournament
 * (the bracket, the match's teams ringed) and Rosters (players opening their
 * pages). S-tier only, like every bo3.gg query.
 *
 * Live, the fast lane reads bo3.gg's last snapshot every 5 s
 * (DetailView.fastLane): the hero says the map being played round by round
 * ("Mirage 9–7", "Round 17"), a round won, a map won and the series won are
 * moments (data/cs2.ts `csMoments`), and whichever reading is further on,
 * the lane's or the full load's, is the one shown, so the score never steps
 * back. A round or a map won refreshes the rest at once (web addition: the
 * round list catches up with the score instead of in half a minute). The
 * hero's maps count is the lane's the moment a map ends.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { coStreamerName, coStreamerURL, coStreamListed, csMoments, fetchCSLive, mapsCaption, newerReading, pointChip, rosterIsEmpty } from "../../../data/cs2";
import { EMPTY_DETAIL } from "../../../data/gameDetail";
import { getJSON } from "../../../data/http";
import { Accessory, type AccessoryTier } from "../../../data/matchRules";
import { competitors, type CSLive, type Side } from "../../../data/models";
import { csLiveLine } from "../../../data/providers/counterStrike";
import { bracketPath } from "../../../data/schedule";
import type { Section } from "../../../data/sections";
import { useSettings } from "../../../state/settings";
import { SeriesLink } from "../core/CommonSections";
import { DetailSection } from "../core/DetailSection";
import { LANE_INTERVAL, useFastLane, type GameContext, type SportPage } from "../core/sport";
import { CoStreamBadge, MapList, RosterColumns, StreamList } from "./MatchParts";
import { RoundHistory } from "./RoundHistory";
import styles from "./CounterStrike.module.css";

const sameReading = (a: CSLive | null, b: CSLive | null) =>
  a === b ||
  (a != null &&
    b != null &&
    a.mapNumber === b.mapNumber &&
    a.mapName === b.mapName &&
    a.round === b.round &&
    a.topScore === b.topScore &&
    a.bottomScore === b.bottomScore &&
    a.topSide === b.topSide &&
    a.bottomSide === b.bottomSide &&
    a.mapEnded === b.mapEnded);

export function useCounterStrikePage(game: GameContext): SportPage {
  const { event, detail, palette, live, spoken } = game;
  const loaded = detail !== EMPTY_DETAIL;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;

  // The reading on show: the lane's or the full load's, whichever is further on (DetailView.apply).
  const [reading, setReading] = useState<CSLive | null>(detail.csLive);
  const current = useRef(reading);
  const maps = useRef(detail.maps);
  maps.current = detail.maps;
  const refresh = useRef(game.refresh);
  refresh.current = game.refresh;
  const accept = useCallback(
    (next: CSLive | null, fromLane: boolean) => {
      const was = current.current;
      // A full load never takes the lane's reading back, nor away.
      if (!fromLane && was && (!next || !newerReading(next, was))) return;
      if (sameReading(was, next)) return;
      const moments = was && next ? csMoments(was, next, spoken, maps.current) : [];
      if (moments.length > 0) game.moments.offer(moments);
      current.current = next;
      setReading(next);
      // A round or a map won: the rest (the round list, the maps) catches up now, not in half a minute.
      if (fromLane && moments.length > 0) refresh.current();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.moments, spoken.top, spoken.bottom],
  );
  useEffect(() => accept(detail.csLive, false), [detail.csLive, accept]);

  useFastLane(live && loaded, LANE_INTERVAL.standard, async (signal) => {
    const next = await fetchCSLive(event, getJSON, signal);
    if (!signal.aborted) accept(next, true);
  });

  const shown = live ? reading : null;
  const onMap = shown && !shown.mapEnded ? shown : null;

  // Short names: bo3.gg's own acronyms ("VIT", "MGZ") beat anything derived from the name.
  const names = useMemo(
    () => ({ top: detail.topRoster.acronym ?? top?.abbreviation ?? "", bottom: detail.bottomRoster.acronym ?? bottom?.abbreviation ?? "" }),
    [detail.topRoster.acronym, detail.bottomRoster.acronym, top?.abbreviation, bottom?.abbreviation],
  );

  // The co-streamer, when bo3.gg lists their own channel among the match's streams (ScoreStore.noteStreams).
  const showCoStream = useSettings((s) => s.showCoStream);
  const handle = useSettings((s) => s.coStreamer);
  const coURL = coStreamerURL(handle);
  const coStream = showCoStream && live && coURL && coStreamListed(detail.streams, handle) ? { name: coStreamerName(handle), url: coURL } : null;

  // The maps count, the lane's the moment a map ends (never behind the scoreboard's).
  const laneScores = useMemo(() => {
    if (!live || !loaded || !top || !bottom) return null;
    const won = (side: Side) => detail.maps.filter((m) => m.winner === side).length;
    const ended = shown?.mapEnded && detail.maps.find((m) => m.number === shown.mapNumber)?.winner == null ? (shown.topScore > shown.bottomScore ? "top" : shown.bottomScore > shown.topScore ? "bottom" : null) : null;
    const t = won("top") + (ended === "top" ? 1 : 0);
    const b = won("bottom") + (ended === "bottom" ? 1 : 0);
    if (t + b < (Number(top.score) || 0) + (Number(bottom.score) || 0)) return null;
    return { top: String(t), bottom: String(b) };
  }, [live, loaded, top, bottom, detail.maps, shown]);

  const sections: Partial<Record<Section, ReactNode>> = {};
  if (top && bottom && detail.maps.length > 0) {
    sections.maps = (
      <DetailSection id="maps" title="Maps" caption={mapsCaption(detail.maps)}>
        <MapList maps={detail.maps} final={event.state === "final"} live={shown} top={top} bottom={bottom} />
      </DetailSection>
    );
  }
  if (Object.keys(detail.rounds).length > 0) {
    sections.rounds = (
      <DetailSection
        id="rounds"
        title="Rounds"
        caption="Each square is a round, filled in the winner's row. First to 13; OT first to 4."
        spokenCaption="Each square is a round, filled in the winner's row. First to 13; overtime first to 4."
        accessory={live ? "live" : "final"}
      >
        <RoundHistory rounds={detail.rounds} maps={detail.maps} palette={palette} names={names} spoken={spoken} reading={shown} />
      </DetailSection>
    );
  }
  if (detail.streams.length > 0 || coStream) {
    sections.streams = (
      <DetailSection id="streams" title="Watch" caption="Streams listed by bo3.gg, official first. Viewer counts are live.">
        <StreamList streams={detail.streams} coStream={coStream} />
      </DetailSection>
    );
  }
  const tournament = detail.tournament;
  if (tournament) {
    sections.bracket = (
      <DetailSection id="bracket" title="Tournament" caption={tournament.stage ?? "The full tournament, stage by stage."}>
        <SeriesLink title={tournament.name} to={bracketPath({ kind: "csTournament", slug: tournament.slug, name: tournament.name }, competitors(event).map((c) => c.id))} />
      </DetailSection>
    );
  }
  if (top && bottom && (!rosterIsEmpty(detail.topRoster) || !rosterIsEmpty(detail.bottomRoster))) {
    sections.rosters = (
      <DetailSection id="rosters" title="Rosters" caption="Each team's current lineup on bo3.gg. May differ from who plays.">
        <RosterColumns top={detail.topRoster} bottom={detail.bottomRoster} topTeam={top} bottomTeam={bottom} />
      </DetailSection>
    );
  }

  // The series winner, once it's over (one map isn't a series).
  const trophy = event.state === "final" && detail.maps.length > 1 && top && bottom ? (top.isWinner ? "top" : bottom.isWinner ? "bottom" : null) : null;
  const chip = live ? (pointChip(onMap, detail.maps)?.text ?? null) : null;

  return {
    sections,
    laneScores,
    // The big score counts maps; this is the map being played, round by round.
    clockFallback: onMap ? csLiveLine(onMap) : (event.detail ?? "Live"),
    heroSecond: onMap?.round != null ? `Round ${onMap.round}` : null,
    heroSpoken: onMap ? `${onMap.mapName ? `${onMap.mapName} ` : ""}${onMap.topScore} to ${onMap.bottomScore}${onMap.round != null ? `, round ${onMap.round}` : ""}${coStream ? `. ${coStream.name} is co-streaming` : ""}` : coStream ? `${coStream.name} is co-streaming` : null,
    dockDetail: onMap?.round != null ? (tier: AccessoryTier) => (tier >= Accessory.text ? <span className={styles.dockRound}>R{onMap.round}</span> : null) : undefined,
    chip,
    heroBadge: coStream ? <CoStreamBadge name={coStream.name} url={coStream.url} /> : null,
    trophy,
  };
}
