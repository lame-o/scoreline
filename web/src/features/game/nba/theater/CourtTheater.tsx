/**
 * The basketball theater's place in the Shot Chart section, above the court
 * (DetailView.swift's `.court`, live): the theater itself loads as its own
 * chunk the first time a page shows a live court, with an empty well of the
 * same size standing in so nothing below it moves. The court under it
 * bursts nothing while it's shown (`BasketballCelebration.courtBursts`);
 * its shot stories play either way.
 *
 *     <CourtTheater feed={feed} teams={teams} event={event} palette={palette} names={names} topIsHome people={detail.people} />
 */
import { lazy, Suspense } from "react";
import type { BasketballFeed, Teams } from "../../../../data/liveFeeds/basketball";
import type { ScoreEvent } from "../../../../data/models";
import type { TeamPalette } from "../../../../data/teamColors";
import type { TheaterPerson } from "../../../../data/theater/theaterPeople";
import { TheaterWell } from "../../core/theater/TheaterWell";
import styles from "./CourtTheater.module.css";

const BasketballTheater = lazy(() => import("./BasketballTheater"));

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
}

export function CourtTheater({ feed, teams, event, palette, names, spoken, topIsHome, people }: CourtTheaterProps) {
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const kits = {
    top: { color: top?.color ?? null, alternate: top?.alternateColor ?? null },
    bottom: { color: bottom?.color ?? null, alternate: bottom?.alternateColor ?? null },
  };
  return (
    <div className={styles.slot}>
      <Suspense fallback={<TheaterWell />}>
        <BasketballTheater
          feed={feed}
          teams={teams}
          kits={kits}
          palette={palette}
          topIsHome={topIsHome}
          topName={names.top}
          bottomName={names.bottom}
          topTeam={top?.name ?? spoken?.top ?? ""}
          bottomTeam={bottom?.name ?? spoken?.bottom ?? ""}
          eventId={event.id}
          people={people}
        />
      </Suspense>
    </div>
  );
}
