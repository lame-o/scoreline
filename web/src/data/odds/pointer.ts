/**
 * The moment being read (OddsChart.swift `OddsPointer`), shared by both
 * modules' scrubs (which set it) and the legend, the sources line and the
 * footer (which read it). An object outside React, so a move re-renders only
 * the readers that select what changed (`active` flips only as reading starts
 * and ends), never the section or the plot.
 *
 * Four things can ask for a reading, and the first with an answer wins, as
 * the linked focus puts the hover over the pin: a row or mark the page links
 * to, the pointer over a chart, the keyboard's reading, the pin. Each has its
 * own state and its own end: the pointer leaving a chart clears the pointer's
 * reading, whatever has keyboard focus. Times are epoch ms.
 */
import { GAME, periodWindow, sameWindow, windowPeriod, type Domain, type OddsWindow } from "./history";
import { destination } from "./timeline";
import type { TimelineMark } from "./marks";

/** The page's linked focus, as far as a pin goes (core/linked.tsx `LinkedFocusStore`). */
export interface PinTarget {
  pinFocus(focus: { readonly play: string }): void;
  unpin(): boolean;
}

export class OddsPointer {
  moment: number | null = null;
  /** Whether anything is being read: flips only as reading starts and ends (the live ends step back). */
  active = false;
  /** What a click holds while the live feed continues to arrive, and the play it's on. */
  held: number | null = null;
  heldPlay: string | null = null;
  /** The two independent modules always inspect the same stretch of time. */
  window: OddsWindow = GAME;

  private hovered: number | null = null;
  private linked: number | null = null;
  private keyed: number | null = null;
  private readonly listeners = new Set<() => void>();
  /** Bumps with every observed change: the token readers' selectors are re-run on. */
  version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get pinned(): boolean {
    return this.held != null;
  }

  private changed(): void {
    this.version += 1;
    for (const l of [...this.listeners]) l();
  }

  private settle(dirty = false): void {
    const reading = this.linked ?? this.hovered ?? this.keyed ?? this.held;
    if (this.moment !== reading) {
      this.moment = reading;
      dirty = true;
    }
    if (this.active !== (reading != null)) {
      this.active = reading != null;
      dirty = true;
    }
    if (dirty) this.changed();
  }

  /** The pointer over a chart; null as it leaves. */
  hover(t: number | null): void {
    this.hovered = t;
    this.settle();
  }

  /** A row or mark in focus somewhere on the page. */
  link(t: number | null): void {
    this.linked = t;
    this.settle();
  }

  /** The keyboard's reading; null as the chart loses focus. */
  key(t: number | null): void {
    this.keyed = t;
    this.settle();
  }

  pin(t: number | null, play: string | null = null): void {
    let dirty = false;
    if (this.held !== t) {
      this.held = t;
      dirty = true;
    }
    if (this.heldPlay !== play) {
      const next = t == null ? null : play;
      if (this.heldPlay !== next) {
        this.heldPlay = next;
        dirty = true;
      }
    }
    this.settle(dirty);
  }

  /** Holds a moment, the same pin the page's rows make when it's a play's. */
  hold(t: number, play: string | null, linked: PinTarget | null): void {
    this.keyed = null;
    if (play != null) linked?.pinFocus({ play });
    else linked?.unpin();
    this.pin(t, play);
  }

  /** A click, like the linked focus's togglePin: holds it; again on the same play or spot lets go. Elsewhere, the pin moves. */
  toggle(t: number, play: string | null, range: Domain, linked: PinTarget | null): void {
    const reach = (range.to - range.from) * 0.01;
    const same = play != null ? this.heldPlay === play : this.heldPlay == null && this.held != null && Math.abs(this.held - t) <= reach;
    if (same) this.clear(linked);
    else this.hold(t, play, linked);
  }

  /** Back to the latest. */
  clear(linked: PinTarget | null = null): void {
    this.keyed = null;
    linked?.unpin();
    this.pin(null);
  }

  /** One step in time, a fraction of what's shown: the pin moves, or the keyboard's reading does. */
  step(fraction: number, range: Domain, linked: PinTarget | null): void {
    const span = range.to - range.from;
    const t = Math.min(Math.max((this.moment ?? range.to) + span * fraction, range.from), range.to);
    if (this.pinned) this.hold(t, null, linked);
    else this.key(t);
  }

  /** The window (the Game | 10 min control, or a zoom). */
  setWindow(window: OddsWindow): void {
    if (sameWindow(this.window, window)) return;
    this.window = window;
    this.changed();
  }

  /** Shows one period, or with null the whole game. A pin outside what's shown goes. */
  zoom(period: number | null, span: Domain | null): void {
    const next = period != null ? periodWindow(period) : GAME;
    const moved = !sameWindow(this.window, next);
    this.window = next;
    this.keyed = null;
    if (span && this.held != null && !(this.held >= span.from && this.held <= span.to)) {
      // The pin changes, so its notification carries the window's too.
      this.pin(null);
    } else {
      this.settle(moved);
    }
  }

  /** Esc: a held reading goes first, then the zoom. Whether there was anything to undo. */
  back(linked: PinTarget | null): boolean {
    if (this.keyed != null || this.pinned) {
      this.clear(linked);
      return true;
    }
    if (windowPeriod(this.window) == null) return false;
    this.setWindow(GAME);
    return true;
  }
}

/** Holds the next or previous key play, the whole game back in view if it's outside what's shown (MatchInspectionActions.select). */
export function selectKeyPlay(forward: boolean, marks: readonly TimelineMark[], range: Domain, pointer: OddsPointer, linked: PinTarget | null): void {
  const mark = destination(forward, marks, pointer.moment);
  const t = mark?.t;
  if (!mark || t == null) return;
  if (!(t >= range.from && t <= range.to) && windowPeriod(pointer.window) != null) pointer.setWindow(GAME);
  pointer.hold(t, mark.moment.id, linked);
}
