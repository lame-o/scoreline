/**
 * The football theater's place in the Field section, above the drive chart
 * (DetailView.swift's `.field`): the theater itself loads as its own chunk
 * the first time a page shows a live field, with an empty well of the same
 * size standing in so nothing below it moves. The drive chart under it
 * bursts nothing while it's shown (`FootballCelebration.driveChartBursts`).
 * While the page broadcasts the game the theater is the one on the
 * choreography engine (FootballTheater.swift's `source.active` branch:
 * FootballDirected); otherwise today's. `directed` overrides the page's
 * (null: today's).
 *
 *     <FieldTheater feed={feed} teams={teams} situation={situation} event={event} palette={palette} names={names} people={detail.people} />
 */
import { NO_KITS, type MatchColors as TheaterKits } from "../../../../data/matchColors";
import { lazy, Suspense } from "react";
import type { Football } from "../../../../data/gameDetail";
import type { FootballFeed, FootballTeams } from "../../../../data/liveFeeds/football";
import type { ScoreEvent } from "../../../../data/models";
import type { TeamPalette } from "../../../../data/teamColors";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import { usePageDirected, type Directed } from "../../core/theater/pageDirected";
import { TheaterWell } from "../../core/theater/TheaterWell";
import styles from "./FieldTheater.module.css";

const FootballTheater = lazy(() => import("./FootballTheater"));
const FootballDirected = lazy(() => import("./FootballDirected"));

export interface FieldTheaterProps {
  readonly feed: FootballFeed;
  readonly teams: FootballTeams | null;
  readonly situation: Football | null;
  readonly event: ScoreEvent;
  readonly palette: TeamPalette;
  /** The teams' short names: the end zones carry them. */
  readonly names: { readonly top: string; readonly bottom: string };
  /** The box score's players, by athlete ID: the names over the credited men. */
  readonly people: Readonly<Record<string, TheaterPerson>>;
  /** The theater on the choreography engine, over the page's (null: today's; absent: the page's broadcast's). */
  readonly directed?: Directed | null;
  /** The game's colors, decided once (`GameContext.colors`). */
  readonly kits: TheaterKits | null;
}

export function FieldTheater({ feed, teams, situation, event, palette, names, people, directed: given, kits: colors }: FieldTheaterProps) {
  const page = usePageDirected();
  const directed = given === undefined ? page : given;
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  // The game's colors, decided once (MatchColors): what each side wears.
  const kits = colors ?? NO_KITS;
  return (
    <div className={styles.slot}>
      <Suspense fallback={<TheaterWell />}>
        {directed && teams ? (
          <FootballDirected
            source={directed.source}
            cues={directed.cues}
            teams={teams}
            kits={kits}
            palette={palette}
            topName={names.top}
            bottomName={names.bottom}
            names={{ top: top?.name || names.top, bottom: bottom?.name || names.bottom }}
            situation={situation}
            eventId={event.id}
            people={people}
            holding={directed.holding ?? null}
          />
        ) : (
          <FootballTheater
            feed={feed}
            teams={teams}
            situation={situation}
            kits={kits}
            palette={palette}
            topName={names.top}
            bottomName={names.bottom}
            eventId={event.id}
            topTeam={top?.name ?? ""}
            bottomTeam={bottom?.name ?? ""}
            people={people}
          />
        )}
      </Suspense>
    </div>
  );
}
