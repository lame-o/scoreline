/**
 * The shared sections, with the Mac's titles and captions per sport
 * (DetailView.swift `section(_:_:)`): line score, win probability (with
 * Polymarket's odds: core/odds/), team
 * stats, scoring plays or key events, latest plays, where to watch, and the series. A
 * sport's page calls this and adds its own; `overrides` replaces any of
 * them (the NBA's live line score, soccer's key events).
 */
import type { ReactNode } from "react";
import type { DetailMoment } from "../../../data/gameDetail";
import { competitors } from "../../../data/models";
import { bracketPath } from "../../../data/schedule";
import type { PeekInputs } from "../../../data/peek";
import { pageKind, type Section } from "../../../data/sections";
import { reconcileLinescore } from "../../../data/headerSync";
import { useSettings } from "../../../state/settings";
import { LatestPlays, MomentList, SeriesLink, StatBars, WhereToWatch } from "./CommonSections";
import { hasWinProbability, WinProbabilitySection } from "./odds/WinProbabilitySection";
import { SyncedLinescore } from "./headerSync";
import { DetailSection } from "./DetailSection";
import type { GameContext } from "./sport";

export interface CommonOptions {
  /** Every ball in play, for a sport whose line score lights them (unused here; charts read the focus). */
  readonly moments?: readonly DetailMoment[];
  /** The plays the "Latest" section lists (a live lane's, when it's ahead). */
  readonly plays?: readonly string[];
  /** A scoring play's words with its players' names as links (football). */
  readonly momentText?: (m: DetailMoment, text: string) => ReactNode;
}

/** The line score's chart, as its section and the chart peek draw it (null without one). */
export function linescoreChart(game: GameContext): ReactNode {
  const { detail, names, spoken, palette } = game;
  if (!detail.linescore) return null;
  const baseball = pageKind(game.event.ref) === "baseball";
  // No older than the header (the summary trails the lanes).
  return (
    <SyncedLinescore ledger={game.header} linescore={detail.linescore} topName={names.top} bottomName={names.bottom} totals={baseball ? 3 : 1} palette={palette} spokenTop={spoken.top} spokenBottom={spoken.bottom} />
  );
}

/** The line score as the chart peek's pill reads it. */
export function linescorePeek(game: GameContext): PeekInputs["linescore"] {
  const summary = game.detail.linescore;
  const line = summary && game.header ? reconcileLinescore(summary, game.header) : summary;
  return line ? { headers: line.headers, top: line.top, bottom: line.bottom, names: game.names } : null;
}

export function useCommonSections(game: GameContext, options: CommonOptions = {}): Partial<Record<Section, ReactNode>> {
  const { event, detail, palette, names, spoken, live } = game;
  const oddsOn = useSettings((s) => s.odds);
  const kind = pageKind(event.ref);
  const baseball = kind === "baseball";
  const soccer = kind === "soccer";
  const nba = kind === "nba";
  const top = event.content.kind === "match" ? event.content.top : null;
  const bottom = event.content.kind === "match" ? event.content.bottom : null;
  const sections: Partial<Record<Section, ReactNode>> = {};

  if (detail.linescore) {
    const title = baseball ? "Score by Inning" : kind === "espn" || kind === "football" || nba ? "Score by Quarter" : "Score by Period";
    sections.linescore = (
      <DetailSection id="linescore" title={title} caption={baseball ? "Runs per inning. R runs, H hits, E errors." : "Points per period. T is the total."}>
        {linescoreChart(game)}
      </DetailSection>
    );
  }

  // Polymarket's market against ESPN's model and DraftKings' line where there's a market; ESPN's bar where not (core/odds/).
  if (hasWinProbability(game, oddsOn)) sections.winProbability = <WinProbabilitySection game={game} />;

  const moments = options.moments ?? detail.moments;
  if (moments.length > 0) {
    sections.moments = (
      <DetailSection
        id="moments"
        title={soccer ? "Key Events" : nba ? "Key Plays" : "Scoring"}
        caption={
          soccer
            ? "Goals and cards, newest first."
            : nba
              ? `Runs of 8+, late lead changes and each break, newest first. Score is ${names.top}–${names.bottom}.`
              : `Every scoring play, newest first. Score is ${names.top}–${names.bottom} after the play.`
        }
        spokenCaption={soccer ? undefined : nba ? "Runs of 8 or more, late lead changes and each break, newest first." : "Every scoring play, newest first, with the score after it."}
      >
        <MomentList moments={moments} topName={names.top} bottomName={names.bottom} topTeam={top} bottomTeam={bottom} renderText={options.momentText} />
      </DetailSection>
    );
  }

  if (detail.stats.length > 0) {
    const unit = nba ? "game" : "match";
    sections.stats = (
      <DetailSection id="stats" title="Team Stats" caption={live ? `${unit[0]!.toUpperCase()}${unit.slice(1)} totals so far, from ESPN.` : `Final ${unit} totals, from ESPN.`}>
        <StatBars stats={detail.stats} palette={palette} spokenTop={spoken.top} spokenBottom={spoken.bottom} />
      </DetailSection>
    );
  }

  const plays = options.plays ?? detail.recentPlays;
  if (plays.length > 0 && detail.football == null) {
    sections.plays = (
      <DetailSection id="plays" title={live ? "Latest" : "Last Plays"} caption={nba ? "Play-by-play from ESPN, newest first." : "ESPN commentary, newest first."}>
        <LatestPlays plays={plays} />
      </DetailSection>
    );
  }

  if (detail.broadcasters.length > 0) {
    sections.whereToWatch = (
      <DetailSection id="whereToWatch" title="Where to Watch" caption="Official US broadcasts, as listed by ESPN.">
        <WhereToWatch broadcasters={detail.broadcasters} />
      </DetailSection>
    );
  }

  // The bracket this game belongs to: the MLB postseason (CS2 tournaments: the CS2 page adds its own).
  if (baseball && event.stage === "post-season" && event.ref?.kind === "espn") {
    const parts = (event.caption ?? "Postseason").split(" · ");
    const year = new Date(event.start).getFullYear();
    sections.bracket = (
      <DetailSection id="bracket" title="Series" caption={parts.length > 1 ? parts.slice(1).join(" · ") : "The road to the World Series."}>
        <SeriesLink title={parts[0] ?? "Postseason"} to={bracketPath({ kind: "espnPostseason", path: game.leagueID ?? "mlb", year }, competitors(event).map((c) => c.id))} />
      </DetailSection>
    );
  }

  return sections;
}
