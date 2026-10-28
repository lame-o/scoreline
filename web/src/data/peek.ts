/**
 * The chart peek's decisions (LinkedPeek.swift `PeekRouter`, `PeekController`,
 * `PeekLayout`): pure, so they're tested without a page.
 *
 * When a hover or a pin on a row lights something in a chart that's out of
 * view, a small live copy of that chart, showing the same highlight, docks at
 * the edge of the viewport on the side the chart is on. It waits for hover
 * intent (260 ms, not restarted as the pointer crosses rows), then follows at
 * once for the rest of that hover; a pin shows it at once. It never covers the
 * row under the pointer (it takes the other edge, its chevron still pointing
 * at the chart); it holds while the pointer is on it; it goes 220 ms after the
 * focus does, when the chart comes into view, or when nothing would light.
 * On a two-column page it's the chart at full size in its column; a short
 * viewport gets a one-line readout pill instead.
 *
 *     const target = peekTarget(focus, "soccer", inputs, "moments") // "pitch"
 *     controller.update({ focus, pinned, target, visibility, held, blocked })
 */
import { ordinal, plural, periodLabel } from "./format";
import type { Visibility } from "./matchRules";
import type { Side } from "./models";
import type { PageKind, Section } from "./sections";

/** The parts of a linked focus the peek reads (core/linked.tsx `Focus`). */
export interface PeekFocus {
  readonly play?: string;
  readonly period?: number;
  readonly side?: Side | null;
  readonly athlete?: number;
  readonly player?: string;
  readonly round?: number;
  readonly span?: readonly [number, number];
}

/** A mark a focus can land on, with its readout (value first, then what it was). */
export interface PeekMark {
  readonly id: string;
  readonly period?: number | null;
  readonly side?: Side | null;
  readonly player?: string | null;
  readonly lead?: string;
  readonly detail?: string;
}

/** What the page has that a focus can land on, by chart (PeekInputs). */
export interface PeekInputs {
  /** The sections on the page right now. */
  readonly shown: ReadonlySet<Section>;
  /** Soccer: the pitch's shots, cards and (live) recent actions, by play ID. */
  readonly pitch?: readonly PeekMark[];
  /** Soccer: the timeline's goals and cards. */
  readonly timeline?: readonly PeekMark[];
  /** Baseball: balls in play. */
  readonly balls?: readonly PeekMark[];
  /** NBA: every shot on the court. */
  readonly shots?: readonly PeekMark[];
  /** NBA: the game flow's scoring points. */
  readonly flow?: readonly PeekMark[];
  /** NBA: names by athlete ID, and each one's shooting as the court's footer says it. */
  readonly names?: Readonly<Record<string, string>>;
  readonly lines?: Readonly<Record<string, string>>;
  /** The line score: period headers and each team's row, with names. */
  readonly linescore?: { readonly headers: readonly string[]; readonly top: readonly string[]; readonly bottom: readonly string[]; readonly names: { readonly top: string; readonly bottom: string } } | null;
  /** Climbing (athlete ID as `id`): who's on the ascent route, the wall's routes, the scorecards. */
  readonly ascent?: readonly PeekMark[];
  readonly wall?: readonly PeekMark[];
  readonly cards?: readonly PeekMark[];
}

// MARK: - Router

/** Sections whose rows point at a chart elsewhere on the page. A chart's own marks never peek: its footer reads them out. */
export const PEEK_SOURCES: ReadonlySet<Section> = new Set<Section>(["moments", "linescore", "box", "leaders", "results", "startlist"]);

/** Focus.matches: a play; with no play, everything in a period (for one team, if given). */
function matchesMark(focus: PeekFocus, mark: PeekMark): boolean {
  if (focus.play != null) return focus.play === mark.id;
  if (focus.period == null || focus.period !== mark.period) return false;
  return focus.side == null || focus.side === mark.side;
}

/** Whether a court shot lights for a focus (CourtView.lit): one play; else a player's shots; else a period's (for one team, if given). */
function lightsShot(shot: PeekMark, focus: PeekFocus): boolean {
  if (focus.play != null) return shot.id === focus.play;
  if (focus.player != null) return shot.player === focus.player;
  if (focus.period != null) return shot.period === focus.period && (focus.side == null || shot.side === focus.side);
  return false;
}

/**
 * The section that will actually light something for `focus`, by the sport's
 * priority, or null (never a guess). `source` is the section under the
 * pointer, when known (a pin has none).
 */
export function peekTarget(focus: PeekFocus, kind: PageKind, inputs: PeekInputs, source: Section | null = null): Section | null {
  if (source != null && !PEEK_SOURCES.has(source)) return null;
  const shown = (s: Section) => inputs.shown.has(s) && s !== source;
  switch (kind) {
    case "soccer": {
      const play = focus.play;
      if (play == null) return null;
      if (shown("pitch") && (inputs.pitch ?? []).some((m) => m.id === play)) return "pitch";
      if (shown("timeline") && (inputs.timeline ?? []).some((m) => m.id === play)) return "timeline";
      return null;
    }
    case "baseball":
      if (shown("battedBalls") && (inputs.balls ?? []).some((b) => matchesMark(focus, b))) return "battedBalls";
      if (shown("linescore") && focus.period != null) return "linescore";
      return null;
    case "nba":
      if (shown("court") && (inputs.shots ?? []).some((s) => lightsShot(s, focus))) return "court";
      if (shown("flow") && focus.play != null && ((inputs.flow ?? []).some((m) => m.id === focus.play) || focus.period != null)) return "flow";
      return null;
    case "football":
      return shown("linescore") && focus.period != null ? "linescore" : null;
    case "climbing": {
      if (focus.athlete == null) return null;
      const id = String(focus.athlete);
      if (shown("ascent") && (inputs.ascent ?? []).some((m) => m.id === id)) return "ascent";
      if (shown("wall") && (inputs.wall ?? []).some((m) => m.id === id)) return "wall";
      if (shown("scorecard") && (inputs.cards ?? []).some((m) => m.id === id)) return "scorecard";
      return null;
    }
    default:
      return null;
  }
}

export interface PeekReadout {
  readonly lead: string;
  readonly detail: string;
}

/** "7th inning"; "Q3", "OT", "2OT" (one rule with every other surface). */
function periodName(period: number | undefined, baseball: boolean): string {
  if (period == null) return "";
  return baseball ? `${ordinal(period)} inning` : periodLabel(period, "basketball");
}

/** The target chart's readout for a focus, as its footer would say it: for the short viewport's pill. */
export function peekReadout(focus: PeekFocus, target: Section, inputs: PeekInputs): PeekReadout | null {
  const mark = (marks: readonly PeekMark[] | undefined, id: string | undefined): PeekReadout | null => {
    const m = id == null ? undefined : marks?.find((x) => x.id === id);
    return m ? { lead: m.lead ?? "", detail: m.detail ?? "" } : null;
  };
  switch (target) {
    case "pitch":
      return mark(inputs.pitch, focus.play);
    case "timeline":
      return mark(inputs.timeline, focus.play);
    case "battedBalls": {
      const lit = (inputs.balls ?? []).filter((b) => matchesMark(focus, b));
      const ball = lit[0];
      if (!ball) return null;
      return focus.play == null ? { lead: periodName(focus.period, true), detail: `${lit.length} in play` } : { lead: ball.lead ?? "", detail: ball.detail ?? "" };
    }
    case "court": {
      const lit = (inputs.shots ?? []).filter((s) => lightsShot(s, focus));
      if (focus.play != null) return lit[0] ? { lead: lit[0].lead ?? "", detail: lit[0].detail ?? "" } : null;
      const made = lit.filter((s) => (s.lead ?? "").startsWith("Made")).length;
      const line = `${made} of ${plural(lit.length, "shot")}`;
      if (focus.player != null) return { lead: inputs.names?.[focus.player] ?? "Player", detail: inputs.lines?.[focus.player] ?? line };
      return { lead: periodName(focus.period, false), detail: line };
    }
    case "flow":
      return mark(inputs.flow, focus.play) ?? (focus.period != null ? { lead: periodName(focus.period, false), detail: "" } : null);
    case "linescore": {
      const line = inputs.linescore;
      const period = focus.period;
      if (!line || period == null || period < 1 || period > line.top.length) return null;
      const header = line.headers[period - 1] ?? String(period);
      const top = line.top[period - 1] ?? "–";
      const bottom = line.bottom[period - 1] ?? "–";
      return {
        lead: Number.isInteger(Number(header)) ? periodName(period, line.headers.includes("R")) : header,
        detail: `${line.names.top} ${top} · ${line.names.bottom} ${bottom}`,
      };
    }
    case "ascent":
      return mark(inputs.ascent, focus.athlete != null ? String(focus.athlete) : undefined);
    case "wall":
      return mark(inputs.wall, focus.athlete != null ? String(focus.athlete) : undefined);
    case "scorecard":
      return mark(inputs.cards, focus.athlete != null ? String(focus.athlete) : undefined);
    default:
      return null;
  }
}

// MARK: - Timing

/** The edge the peek docks at. */
export type PeekDock = "top" | "bottom";
/** Where the real chart is: the chevron's direction. */
export type PeekEdge = "above" | "below";

export interface PeekPresentation {
  readonly section: Section;
  readonly dock: PeekDock;
  readonly points: PeekEdge;
}

export interface PeekInput {
  /** What charts show: the hover, else the pin. */
  readonly focus: PeekFocus | null;
  /** Nothing hovered: the focus is a pin. */
  readonly pinned: boolean;
  readonly target: Section | null;
  readonly visibility: Visibility | null;
  /** The pointer is on the peek. */
  readonly held: boolean;
  /** The page's entrance (or a resize): nothing shows. */
  readonly blocked: boolean;
}

export const EMPTY_PEEK_INPUT: PeekInput = { focus: null, pinned: false, target: null, visibility: null, held: false, blocked: false };

/** The peek's clock: real time on the page, a hand-moved one in tests. */
export interface PeekClock {
  readonly now: () => number;
  /** Runs `action` after `ms`; returns a cancel. */
  readonly after: (ms: number, action: () => void) => () => void;
}

export const liveClock: PeekClock = {
  now: () => performance.now(),
  after: (ms, action) => {
    const timer = setTimeout(action, ms);
    return () => clearTimeout(timer);
  },
};

function samePeekFocus(a: PeekFocus | null, b: PeekFocus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.play === b.play && a.period === b.period && (a.side ?? null) === (b.side ?? null) && a.athlete === b.athlete && a.player === b.player && a.round === b.round && a.span?.[0] === b.span?.[0] && a.span?.[1] === b.span?.[1];
}

/**
 * When the peek shows, where it docks and when it goes (PeekController).
 * Inputs come from the host on every change; timers are owned here and
 * cancelled on every state change, never stacked.
 *
 * idle → pending (260 ms of intent, not restarted as the pointer crosses rows)
 * → showing → (focus gone for 220 ms, the chart in view, no target) → idle.
 * A pin shows at once, and so does anything after the first peek of a hover.
 */
export class PeekController {
  static readonly INTENT = 260;
  static readonly GRACE = 220;

  private presentedValue: PeekPresentation | null = null;
  /** Bumped when a clicked peek's chart arrives in view: its border flashes once. */
  private arrivalCount = new Map<Section, number>();
  private input: PeekInput = EMPTY_PEEK_INPUT;
  private pendingSince: number | null = null;
  private intentTimer: (() => void) | null = null;
  private graceTimer: (() => void) | null = null;
  /** A peek has shown during this hover: the next one needs no wait. */
  private warm = false;
  private lastFocus: PeekFocus | null = null;
  private awaiting: Section | null = null;
  private listeners = new Set<() => void>();

  /** Whether the pointer is in a dock edge's band (the peek's height plus 12pt). */
  pointerInBand: (dock: PeekDock) => boolean = () => false;
  /** A clicked peek's chart arrived in view (the host flashes its border). */
  onArrival: (section: Section) => void = () => {};

  constructor(private readonly clock: PeekClock = liveClock) {}

  presented = (): PeekPresentation | null => this.presentedValue;
  arrivals = (section: Section): number => this.arrivalCount.get(section) ?? 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private present(next: PeekPresentation | null): void {
    const p = this.presentedValue;
    if (p === next || (p && next && p.section === next.section && p.dock === next.dock && p.points === next.points)) return;
    this.presentedValue = next;
    this.emit();
  }

  update(next: PeekInput): void {
    this.input = next;
    this.evaluate();
  }

  /** The peek was clicked: flash the chart once it's in view. */
  expectArrival(section: Section): void {
    this.awaiting = section;
  }

  dispose(): void {
    this.cancelIntent();
    this.cancelGrace();
    this.listeners.clear();
  }

  private evaluate(): void {
    const i = this.input;
    if (i.blocked) {
      this.cancelIntent();
      this.cancelGrace();
      this.pendingSince = null;
      this.present(null);
      return;
    }
    const focus = i.focus;
    if (!focus) {
      this.cancelIntent();
      this.pendingSince = null;
      if (!this.presentedValue) {
        // Nothing focused and nothing shown: the next hover waits for intent again.
        this.warm = false;
        this.lastFocus = null;
        this.cancelGrace();
        return;
      }
      // Crossing the gap between rows doesn't flicker; the peek under the pointer stays.
      if (i.held) {
        this.cancelGrace();
        return;
      }
      if (!this.graceTimer) this.graceTimer = this.clock.after(PeekController.GRACE, () => this.graceEnded());
      return;
    }
    this.cancelGrace();
    const focusChanged = !samePeekFocus(focus, this.lastFocus);
    this.lastFocus = focus;
    const target = i.target;
    const visibility = i.visibility;
    if (!target || !visibility) {
      this.cancelIntent();
      this.pendingSince = null;
      this.present(null);
      return;
    }
    if (visibility === "visible") {
      this.cancelIntent();
      this.pendingSince = null;
      this.present(null);
      if (this.awaiting === target) {
        this.arrivalCount.set(target, (this.arrivalCount.get(target) ?? 0) + 1);
        this.awaiting = null;
        this.onArrival(target);
      }
      return;
    }
    if (visibility === "partialAbove" || visibility === "partialBelow") {
      // 40–60% in view: keep doing whatever it was doing (hysteresis).
      const p = this.presentedValue;
      if (p && p.section !== target) this.present({ ...p, section: target });
      return;
    }
    const edge: PeekEdge = visibility === "hiddenAbove" ? "above" : "below";
    const p = this.presentedValue;
    if (p) {
      // The same chart: the highlight inside updates; nothing re-enters.
      // The edge is chosen again only for a new focus or a new side.
      if (p.section === target && p.points === edge && !focusChanged) return;
      const dock = focusChanged || p.points !== edge ? this.chooseDock(edge) : p.dock;
      this.present({ section: target, dock, points: edge });
    } else if (i.pinned || this.warm) {
      this.show(target, edge);
    } else if (this.pendingSince != null) {
      if (this.clock.now() - this.pendingSince >= PeekController.INTENT) this.show(target, edge);
    } else {
      this.pendingSince = this.clock.now();
      this.intentTimer = this.clock.after(PeekController.INTENT, () => {
        this.intentTimer = null;
        this.evaluate();
      });
    }
  }

  private show(target: Section, edge: PeekEdge): void {
    this.cancelIntent();
    this.pendingSince = null;
    this.warm = true;
    this.present({ section: target, dock: this.chooseDock(edge), points: edge });
  }

  private graceEnded(): void {
    this.graceTimer = null;
    if (this.input.focus != null || this.input.held) return;
    this.present(null);
    this.warm = false;
    this.lastFocus = null;
  }

  /** The chart's own side, unless the pointer is in that edge's band (the peek would cover the row being read): then the other edge. */
  private chooseDock(edge: PeekEdge): PeekDock {
    const preferred: PeekDock = edge === "above" ? "top" : "bottom";
    return this.pointerInBand(preferred) ? (preferred === "top" ? "bottom" : "top") : preferred;
  }

  private cancelIntent(): void {
    this.intentTimer?.();
    this.intentTimer = null;
  }

  private cancelGrace(): void {
    this.graceTimer?.();
    this.graceTimer = null;
  }
}

// MARK: - Layout

export type PeekMode = "compact" | "column" | "pill";

/** Under 360pt tall a chart would cover too much: a readout pill. Two columns: the chart at its column's size. */
export function peekMode(viewport: { width: number; height: number }, split: boolean): PeekMode {
  return viewport.height < 360 ? "pill" : split ? "column" : "compact";
}

/** A compact peek's plot height: at most 150, never a third of the viewport. */
export function peekPlotHeight(viewport: { height: number }): number {
  return Math.min(150, 0.32 * viewport.height);
}

/** The header and the plate's insets around the chart. */
export const PEEK_CHROME = 32;

/** The most a compact peek's chart may take: the plot plus a footer line. */
export function peekChartCap(viewport: { height: number }): number {
  return Math.max(peekPlotHeight(viewport) + 24, 0.42 * viewport.height);
}

/** Compact width: the chart's aspect at the plot height (full width without one), at least 180, inside 10pt margins. */
export function peekCompactWidth(viewport: { width: number; height: number }, aspect: number | null): number {
  const full = Math.max(viewport.width - 20, 0);
  if (aspect == null) return full;
  return Math.min(full, Math.max(180, peekPlotHeight(viewport) * aspect + 20));
}

/** The tallest the card gets, for the pointer band. */
export function peekHeight(viewport: { width: number; height: number }, mode: PeekMode): number {
  switch (mode) {
    case "compact":
      return peekPlotHeight(viewport) + PEEK_CHROME;
    case "column":
      return 0.45 * viewport.height + PEEK_CHROME;
    case "pill":
      return 26;
  }
}

// MARK: - Excerpts

/** A climber's lane and their neighbors by rank, on each route they're on; every route when they're on none (DetailView.wallExcerpt). */
export function wallExcerpt<R extends { readonly climbers: readonly { readonly id: number }[] }>(routes: readonly R[], athlete: number): readonly R[] {
  const excerpt = routes.flatMap((route) => {
    const i = route.climbers.findIndex((c) => c.id === athlete);
    if (i < 0) return [];
    return [{ ...route, climbers: route.climbers.slice(Math.max(i - 1, 0), Math.min(i + 1, route.climbers.length - 1) + 1) }];
  });
  return excerpt.length > 0 ? excerpt : routes;
}
