/**
 * The soccer theater's place at the top of the Live Pitch (DetailView.swift's
 * `.pitch`, live): the theater itself loads as its own chunk the first time
 * a page shows a live pitch, with an empty well of the same size standing in
 * so nothing below it moves. While it's shown, the pitch bursts only for
 * moments the theater doesn't own (`GoalCelebration.pitchBursts`). While the
 * page broadcasts the match the theater is the one on the choreography
 * engine (SoccerTheater.swift's `source.active` branch: SoccerDirected, the
 * home team on top as the page has it); otherwise today's. `directed`
 * overrides the page's (null: today's).
 *
 *     <PitchTheater feed={feed} homeTeamID={homeID} event={event} added={detail.soccerAdded} people={detail.people} />
 */
import { NO_KITS, type MatchColors as TheaterKits } from "../../../../data/matchColors";
import { lazy, Suspense } from "react";
import type { SoccerFeed } from "../../../../data/liveFeeds/soccer";
import type { ScoreEvent } from "../../../../data/models";
import type { SoccerAddedTime } from "../../../../data/soccer";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import { usePageDirected, type Directed } from "../../core/theater/pageDirected";
import { TheaterWell } from "../../core/theater/TheaterWell";
import styles from "./PitchTheater.module.css";

const SoccerTheater = lazy(() => import("./SoccerTheater"));
const SoccerDirected = lazy(() => import("./SoccerDirected").then((m) => ({ default: m.SoccerDirectedLive })));

export interface PitchTheaterProps {
  readonly feed: SoccerFeed;
  /** The home (top) team's ESPN ID: the plays' frames turn on it. */
  readonly homeTeamID: string | null;
  readonly event: ScoreEvent;
  /** The added time last announced (the summary's commentary), for the theater's tag. */
  readonly added?: SoccerAddedTime | null;
  /** The squads, by athlete ID (the summary's rosters): the names over the players. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** The theater on the choreography engine, over the page's (null: today's; absent: the page's broadcast's). */
  readonly directed?: Directed | null;
  /** The game's colors, decided once (`GameContext.colors`). */
  readonly kits: TheaterKits | null;
}

/** A team's color for the tag, as hex without the hash (the kit's own, else none). */
const tagColor = (color: string | null | undefined): string | null => (color ? color.replace(/^#/, "") : null);

export function PitchTheater({ feed, homeTeamID, event, added = null, people, directed: given, kits: colors }: PitchTheaterProps) {
  const page = usePageDirected();
  const directed = given === undefined ? page : given;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  // The game's colors, decided once (MatchColors): what each side wears, today's theater and the directed one alike.
  const kits = colors ?? NO_KITS;
  const names = { top: top?.name ?? "", bottom: bottom?.name ?? "", topColor: tagColor(kits.top.color), bottomColor: tagColor(kits.bottom.color) };
  return (
    <div className={styles.slot}>
      <Suspense fallback={<TheaterWell />}>
        {directed ? (
          <SoccerDirected
            feed={feed}
            source={directed.source}
            cues={directed.cues}
            homeTeamID={homeTeamID}
            kits={kits}
            names={names}
            eventId={event.id}
            people={people}
            atBreak={directed.interval ?? false}
            holding={directed.holding ?? null}
          />
        ) : (
          <SoccerTheater feed={feed} homeTeamID={homeTeamID} kits={kits} eventId={event.id} topTeam={top?.name ?? ""} bottomTeam={bottom?.name ?? ""} added={added} people={people} />
        )}
      </Suspense>
    </div>
  );
}
