/**
 * A row's "Show on {chart}" (ChartLinks.swift): the section that lights a
 * focus (a play, a player, a period, a climber), by the sport's priority, or
 * null (never a guess). Pure routing, tested; the page builds the inputs and
 * names the action on a pinnable row (core/linked.tsx `useShowOnChart`).
 * Every sport's key plays reach the timeline.
 */
import type { EventRef, Side } from "./models";
import { NBA_PATH } from "./providers/espn";
import type { Section } from "./sections";

/** A mark a focus can match (ChartLinkInputs.Mark). */
export interface ChartMark {
  readonly id: string;
  readonly period?: number | null;
  readonly side?: Side | null;
  readonly player?: string | null;
}

/** What the page has that a focus can land on, by section. */
export interface ChartLinkInputs {
  /** The sections on the page right now. */
  readonly shown: ReadonlySet<Section>;
  /** Soccer: the pitch's shots, cards and (live) recent actions, by play ID. */
  readonly pitch?: readonly ChartMark[];
  /** Every sport: the timeline's marks. */
  readonly timeline?: readonly ChartMark[];
  /** Baseball: balls in play. */
  readonly balls?: readonly ChartMark[];
  /** NBA: every shot on the court. */
  readonly shots?: readonly ChartMark[];
  /** NBA: the game flow's scoring points. */
  readonly flow?: readonly ChartMark[];
  /** Climbing: who's on the ascent route, the wall's routes, the scorecard (athlete ID as `id`). */
  readonly ascent?: readonly ChartMark[];
  readonly wall?: readonly ChartMark[];
  readonly cards?: readonly ChartMark[];
}

/** What a row's focus says (core/linked.tsx `Focus`, as far as routing reads it). */
export interface LinkFocus {
  readonly play?: string;
  readonly period?: number;
  readonly side?: Side | null;
  readonly athlete?: number;
  readonly player?: string;
}

/** A play, or with no play, everything in a period (for one team, if given) (Focus.matches). */
function matchesFocus(focus: LinkFocus, mark: ChartMark): boolean {
  if (focus.play != null) return focus.play === mark.id;
  if (focus.period == null || focus.period !== mark.period) return false;
  return focus.side == null || focus.side === mark.side;
}

/** Whether a court shot lights for a focus (`CourtView.lit`): one play; else a player's shots; else a period's (for one team, if given). */
function lights(shot: ChartMark, focus: LinkFocus): boolean {
  if (focus.play != null) return shot.id === focus.play;
  if (focus.player != null) return shot.player === focus.player;
  if (focus.period != null) return shot.period === focus.period && (focus.side == null || shot.side === focus.side);
  return false;
}

/** The timeline, when the focus is one of its marks: every sport has one. */
function timeline(focus: LinkFocus, inputs: ChartLinkInputs): Section | null {
  const play = focus.play;
  if (!inputs.shown.has("timeline") || play == null || !(inputs.timeline ?? []).some((m) => m.id === play)) return null;
  return "timeline";
}

/** The section that will actually light something for `focus`, by the sport's priority, or null (never a guess). (pure; tested) */
export function chartTarget(focus: LinkFocus, ref: EventRef | null, inputs: ChartLinkInputs): Section | null {
  const shown = (s: Section) => inputs.shown.has(s);
  if (ref?.kind === "climbing") {
    if (focus.athlete == null) return null;
    const id = String(focus.athlete);
    if (shown("ascent") && (inputs.ascent ?? []).some((m) => m.id === id)) return "ascent";
    if (shown("wall") && (inputs.wall ?? []).some((m) => m.id === id)) return "wall";
    if (shown("scorecard") && (inputs.cards ?? []).some((m) => m.id === id)) return "scorecard";
    return null;
  }
  if (ref?.kind !== "espn") return null;
  switch (ref.sport) {
    case "soccer": {
      const play = focus.play;
      if (play == null) return null;
      if (shown("pitch") && (inputs.pitch ?? []).some((m) => m.id === play)) return "pitch";
      if (shown("timeline") && (inputs.timeline ?? []).some((m) => m.id === play)) return "timeline";
      return null;
    }
    case "baseball":
      if (shown("battedBalls") && (inputs.balls ?? []).some((m) => matchesFocus(focus, m))) return "battedBalls";
      if (shown("linescore") && focus.period != null) return "linescore";
      return timeline(focus, inputs);
    case "basketball": {
      if (ref.path !== NBA_PATH) return null;
      if (shown("court") && (inputs.shots ?? []).some((m) => lights(m, focus))) return "court";
      const play = focus.play;
      if (shown("flow") && play != null && ((inputs.flow ?? []).some((m) => m.id === play) || focus.period != null)) return "flow";
      return timeline(focus, inputs);
    }
    case "football":
      return shown("linescore") && focus.period != null ? "linescore" : timeline(focus, inputs);
    default:
      return null;
  }
}

/** The chart's name in "Show on {chart}" (DetailView's section titles). */
export function chartName(section: Section, live: boolean): string {
  switch (section) {
    case "pitch":
      return live ? "Live Pitch" : "Shot Map";
    case "timeline":
      return "Timeline";
    case "battedBalls":
      return "Balls in Play";
    case "linescore":
      return "Line Score";
    case "court":
      return "Shot Chart";
    case "flow":
      return "Game Flow";
    case "ascent":
      return "Ascent";
    case "wall":
      return "High Points";
    case "scorecard":
      return "Scorecard";
    default:
      return section;
  }
}
