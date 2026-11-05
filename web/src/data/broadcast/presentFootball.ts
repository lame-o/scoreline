/**
 * Football's field at p (Broadcast.swift `footballPossession`,
 * `footballSituation`): who has the ball, and the down, distance and spot
 * after the last told play (its end), so the field never runs ahead of the
 * play the page has told. With the football page's chunk (it reads the
 * football lane's situation rule).
 */
import type { Football } from "../gameDetail";
import { at, str, type JSONValue } from "../json";
import { footballSituation as situationOf, teamSide, type FootballTeams } from "../liveFeeds/football";
import { teamIDFromRef } from "../liveFeeds/baseball";
import type { Side } from "../models";
import { b } from "../profiles/read";
import type { Broadcast } from "./broadcast";
import { isInterval, isUnderway } from "./presentedGame";

/** The team with the ball after the last told play (none in a break). */
export function footballPossession(broadcast: Broadcast, teams: FootballTeams): Side | null {
  const play = broadcast.lastToldPlay;
  if (!broadcast.active || !isUnderway(broadcast.presented) || play == null) return null;
  return teamSide(teams, teamIDFromRef(str(at(play, "end", "team", "$ref"))) ?? str(at(play, "end", "team", "id")) ?? teamIDFromRef(str(at(play, "team", "$ref"))) ?? str(at(play, "team", "id")) ?? null);
}

/** The down, distance and spot after the last told play (its end); in a break, the ball where it lay with no down or possession. */
export function footballSituation(broadcast: Broadcast, teams: FootballTeams, fallback: Football | null): Football | null {
  if (broadcast.active && isInterval(broadcast.presented)) {
    if (!fallback) return null;
    return { downDistance: null, ballX: fallback.ballX, lineToGainX: null, possession: null, redZone: false, topTimeouts: fallback.topTimeouts, bottomTimeouts: fallback.bottomTimeouts, lastPlay: fallback.lastPlay };
  }
  const play = broadcast.lastToldPlay;
  const end = at(play, "end");
  if (!broadcast.active || play == null || end == null || typeof end !== "object" || Array.isArray(end)) return fallback;
  const situation: Record<string, JSONValue> = { ...(end as Record<string, JSONValue>) };
  situation.homeTimeouts = fallback ? (teams.topIsHome ? fallback.topTimeouts : fallback.bottomTimeouts) : null;
  situation.awayTimeouts = fallback ? (teams.topIsHome ? fallback.bottomTimeouts : fallback.topTimeouts) : null;
  const team = teamIDFromRef(str(at(play, "end", "team", "$ref"))) ?? str(at(play, "end", "team", "id")) ?? null;
  const scored = b(at(play, "scoringPlay")) === true;
  return situationOf(situation, team, teams, str(at(play, "text")) ?? null, scored) ?? fallback;
}
