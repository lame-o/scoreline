/**
 * The basketball theater's place in the Shot Chart section, above the court
 * (DetailView.swift's `.court`, live): the theater itself loads as its own
 * chunk the first time a page shows a live court, with an empty well of the
 * same size standing in so nothing below it moves. The court under it
 * bursts nothing while it's shown (`BasketballCelebration.courtBursts`);
 * its shot stories play either way. While the page broadcasts the game
 * (`directed`: its source and the slides' cues), the theater is the one on
 * the choreography engine (BasketballTheater.swift's `source.active` branch:
 * BasketballDirected); otherwise today's, which tells the lane's plays as
 * they come.
 *
 *     <CourtTheater feed={feed} teams={teams} event={event} palette={palette} names={names} topIsHome people={detail.people} directed={broadcast} />
 */
import { lazy, Suspense } from "react";
import type { BasketballFeed, Teams } from "../../../../data/liveFeeds/basketball";
import type { ScoreEvent } from "../../../../data/models";
import type { TeamPalette } from "../../../../data/teamColors";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import type { BroadcastTheaterSource } from "../../../../data/theater/theaterSource";
import type { TheaterCues } from "../../../../data/theater/theaterView";
import { TheaterWell } from "../../core/theater/TheaterWell";
import styles from "./CourtTheater.module.css";

const BasketballTheater = lazy(() => import("./BasketballTheater"));
const BasketballDirected = lazy(() => import("./BasketballDirected"));

/** The page's broadcast, while it runs, and the slides' cues: the theater on the engine. */
export interface Directed {
  readonly source: BroadcastTheaterSource;
  readonly cues: TheaterCues | null;
  /** A game held up says so over anything else, in ESPN's words ("Rain Delay"). */
  readonly holding?: string | null;
}

export interface CourtTheaterProps {
  readonly feed: BasketballFeed;
  readonly teams: Teams | null;
  readonly event: ScoreEvent;
  readonly palette: TeamPalette;
  /** The teams' short names: the home team's is painted at center court. */
  readonly names: { readonly top: string; readonly bottom: string };
  /** The teams as the tag names them ("SPURS BALL"). */
  readonly spoken?: { readonly top: string; readonly bottom: string };
  readonly topIsHome: boolean;
  /** The box score's players, by athlete ID: the names over the credited men. */
  readonly people?: Readonly<Record<string, TheaterPerson>>;
  /** The page broadcasts the game: the theater on the choreography engine. */
  readonly directed?: Directed | null;
}

export function CourtTheater({ feed, teams, event, palette, names, spoken, topIsHome, people, directed }: CourtTheaterProps) {
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const kits = {
    top: { color: top?.color ?? null, alternate: top?.alternateColor ?? null },
    bottom: { color: bottom?.color ?? null, alternate: bottom?.alternateColor ?? null },
  };
  const topTeam = top?.name ?? spoken?.top ?? "";
  const bottomTeam = bottom?.name ?? spoken?.bottom ?? "";
  return (
    <div className={styles.slot}>
      <Suspense fallback={<TheaterWell />}>
        {directed && teams ? (
          <BasketballDirected
            source={directed.source}
            cues={directed.cues}
            teams={teams}
            kits={kits}
            palette={palette}
            names={{ top: topTeam || names.top, bottom: bottomTeam || names.bottom }}
            homeName={topIsHome ? names.top : names.bottom}
            eventId={event.id}
            people={people}
            heard={null}
            holding={directed.holding ?? null}
          />
        ) : (
          <BasketballTheater
            feed={feed}
            teams={teams}
            kits={kits}
            palette={palette}
            topIsHome={topIsHome}
            topName={names.top}
            bottomName={names.bottom}
            topTeam={topTeam}
            bottomTeam={bottomTeam}
            eventId={event.id}
            people={people}
          />
        )}
      </Suspense>
    </div>
  );
}
