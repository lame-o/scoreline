/**
 * The timed timeline in its place on the page (MatchTimeline.swift
 * `MatchTimelineSection`; DetailView's `.timeline` section, its caption and
 * `timelineHistory`): what's been presented, on the domain Win Probability
 * works out from the same inputs. The two stay independent modules; they
 * share only the inspection state, the chronology, the domain and the plot's
 * insets. Minute-only soccer goals stay on match minutes when a provider has
 * no timestamps.
 */
import { useMemo } from "react";
import { labelWidth, lineColor } from "../../../../data/odds/chart";
import { effectiveWindow, historyDomain, historyNow, shownUntil, type MatchHistory } from "../../../../data/odds/history";
import type { TimelineMark } from "../../../../data/odds/marks";
import type { OddsPointer } from "../../../../data/odds/pointer";
import { pageKind } from "../../../../data/sections";
import type { TeamPalette } from "../../../../data/teamColors";
import { latestTick, useOddsSelect, type OddsFeed } from "../../../../state/odds";
import { DetailSection } from "../DetailSection";
import { measureEndLabel, usePointer, useUntil, type PresentedTime } from "../odds/inspection";
import type { GameContext } from "../sport";
import { MatchTimeline, type TimelineScale } from "./MatchTimeline";

export interface TimelineSectionProps {
  readonly game: GameContext;
  readonly marks: readonly TimelineMark[];
  readonly feed: OddsFeed | null;
  readonly time: PresentedTime;
  readonly pointer: OddsPointer;
  /** The page's team colors (the soccer timeline's; MatchColors replaces them when the web has it). */
  readonly palette: TeamPalette;
  /** Soccer, live: the match minute, for a timeline on match minutes. */
  readonly minute: number | null;
}

/** "Goals and cards by minute. MUN above, BOU below." (DetailView.timelineCaption) */
export function timelineCaption(kind: ReturnType<typeof pageKind>, names: { top: string; bottom: string }, live: boolean): string {
  const what = kind === "soccer" ? "Goals and cards by minute." : kind === "nba" ? "Key plays." : kind === "baseball" ? "Runs by inning." : "Scoring plays and turnovers.";
  return `${what} ${names.top} above, ${names.bottom} below.${live ? " The red dot marks now." : ""}`;
}

/** The wall clock the timeline shares with Win Probability; null keeps match minutes (DetailView.timelineHistory). */
export function timelineHistory(history: MatchHistory | null, soccer: boolean, moments: readonly { readonly minute: number | null }[]): MatchHistory | null {
  if (!history) return null;
  if (soccer && history.events.length === 0 && moments.some((m) => m.minute != null)) return null;
  return history;
}

export function TimelineSection({ game, marks, feed, time, pointer, palette, minute }: TimelineSectionProps) {
  const { event, detail, names, spoken } = game;
  const kind = pageKind(event.ref);
  const live = event.state === "live";
  const history = timelineHistory(detail.history, kind === "soccer", detail.moments);
  const until = useUntil(time);
  const window = effectiveWindow(
    usePointer(pointer, (p) => p.window),
    event.state,
  );
  const latest = useOddsSelect(feed, (s) => latestTick(s, until));
  const threeWay = useOddsSelect(feed, (s) => s.market?.kind === "three-way");
  // Win Probability isn't on the page to hold the pin's controls.
  const standsAlone = !useOddsSelect(feed, (s) => s.status === "ready" && s.market != null);
  const width = useMemo(() => labelWidth([names.top, names.bottom, ...(threeWay ? ["Draw"] : [])], measureEndLabel), [names.top, names.bottom, threeWay]);

  const scale: TimelineScale = useMemo(() => {
    if (!history) return { kind: "minutes", current: live ? minute : null };
    const shown = shownUntil(history, until);
    const domain = historyDomain(shown, event.state, window, event.start, latest, until);
    const now = live ? historyNow(shown, event.start, latest, until) : null;
    return { kind: "wall", history: shown, domain, now, labelWidth: width, window };
  }, [history, live, minute, until, event.state, event.start, window, latest, width]);

  const wall = scale.kind === "wall";
  return (
    <DetailSection id="timeline" title="Timeline" caption={timelineCaption(kind, names, live)} spokenCaption={timelineCaption(kind, spoken, live)}>
      <MatchTimeline
        marks={marks}
        scale={scale}
        topColor={wall ? lineColor(palette.top) : palette.top}
        bottomColor={wall ? lineColor(palette.bottom) : palette.bottom}
        topName={names.top}
        bottomName={names.bottom}
        pointer={pointer}
        showsPinControls={standsAlone}
      />
    </DetailSection>
  );
}
