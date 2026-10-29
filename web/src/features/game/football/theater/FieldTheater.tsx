/**
 * The football theater's place in the Field section, above the drive chart
 * (DetailView.swift's `.field`): the theater itself loads as its own chunk
 * the first time a page shows a live field, with an empty well of the same
 * size standing in so nothing below it moves. The drive chart under it
 * bursts nothing while it's shown (`FootballCelebration.driveChartBursts`).
 *
 *     <FieldTheater feed={feed} teams={teams} situation={situation} event={event} palette={palette} names={names} />
 */
import { lazy, Suspense } from "react";
import type { Football } from "../../../../data/gameDetail";
import type { FootballFeed, FootballTeams } from "../../../../data/liveFeeds/football";
import type { ScoreEvent } from "../../../../data/models";
import type { TeamPalette } from "../../../../data/teamColors";
import { TheaterWell } from "../../core/theater/TheaterWell";
import styles from "./FieldTheater.module.css";

const FootballTheater = lazy(() => import("./FootballTheater"));

export interface FieldTheaterProps {
  readonly feed: FootballFeed;
  readonly teams: FootballTeams | null;
  readonly situation: Football | null;
  readonly event: ScoreEvent;
  readonly palette: TeamPalette;
  /** The teams' short names: the end zones carry them. */
  readonly names: { readonly top: string; readonly bottom: string };
}

export function FieldTheater({ feed, teams, situation, event, palette, names }: FieldTheaterProps) {
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const kits = {
    top: { color: top?.color ?? null, alternate: top?.alternateColor ?? null },
    bottom: { color: bottom?.color ?? null, alternate: bottom?.alternateColor ?? null },
  };
  return (
    <div className={styles.slot}>
      <Suspense fallback={<TheaterWell />}>
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
        />
      </Suspense>
    </div>
  );
}
