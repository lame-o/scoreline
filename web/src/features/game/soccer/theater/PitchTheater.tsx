/**
 * The soccer theater's place at the top of the Live Pitch (DetailView.swift's
 * `.pitch`, live): the theater itself loads as its own chunk the first time
 * a page shows a live pitch, with an empty well of the same size standing in
 * so nothing below it moves. While it's shown, the pitch bursts only for
 * moments the theater doesn't own (`GoalCelebration.pitchBursts`).
 *
 *     <PitchTheater feed={feed} homeTeamID={homeID} event={event} added={detail.soccerAdded} people={detail.people} />
 */
import { lazy, Suspense } from "react";
import type { SoccerFeed } from "../../../../data/liveFeeds/soccer";
import type { ScoreEvent } from "../../../../data/models";
import type { SoccerAddedTime } from "../../../../data/soccer";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import { TheaterWell } from "../../core/theater/TheaterWell";
import styles from "./PitchTheater.module.css";

const SoccerTheater = lazy(() => import("./SoccerTheater"));

export interface PitchTheaterProps {
  readonly feed: SoccerFeed;
  /** The home (top) team's ESPN ID: the plays' frames turn on it. */
  readonly homeTeamID: string | null;
  readonly event: ScoreEvent;
  /** The added time last announced (the summary's commentary), for the theater's tag. */
  readonly added?: SoccerAddedTime | null;
  /** The squads, by athlete ID (the summary's rosters): the names over the players. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
}

export function PitchTheater({ feed, homeTeamID, event, added = null, people }: PitchTheaterProps) {
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const kits = {
    top: { color: top?.color ?? null, alternate: top?.alternateColor ?? null },
    bottom: { color: bottom?.color ?? null, alternate: bottom?.alternateColor ?? null },
  };
  return (
    <div className={styles.slot}>
      <Suspense fallback={<TheaterWell />}>
        <SoccerTheater feed={feed} homeTeamID={homeTeamID} kits={kits} eventId={event.id} topTeam={top?.name ?? ""} bottomTeam={bottom?.name ?? ""} added={added} people={people} />
      </Suspense>
    </div>
  );
}
