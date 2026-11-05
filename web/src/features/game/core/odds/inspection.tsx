/**
 * Inspection shared by the timeline and Win Probability (MatchTimeline.swift
 * `MatchInspection`, `MatchInspectionActions`, `MatchPinControls`,
 * `MatchFocusLink`, `PeriodRow`, `WholeGameLink`, `PinButton`;
 * OddsChart.swift `OddsPointer`): one moment both modules read, set by the
 * pointer over either chart, the keyboard, a click's pin or a row elsewhere
 * on the page.
 *
 * - Hover reads (and its reading ends as the pointer leaves, whatever has
 *   focus); a click holds the moment, or the key play it's on, and again lets
 *   go. ←/→ step through what's shown, ⌥←/→ between key plays, Return holds,
 *   Esc lets go, then unzooms. Instant: nothing here animates.
 * - A key play's row, its mark and its column in the odds are one focus: a
 *   row hovered moves both charts' line, a row pinned holds them there
 *   (`useFocusLink`).
 * - While the page broadcasts, both modules read the same `until` (p when it
 *   last redrew): a store that redraws when p reaches the next pending tick,
 *   or every 15 s for the now line (`usePresentedTime`), one timer, never per
 *   frame.
 *
 * Everything reads the pointer through `usePointer(pointer, select)`, so a
 * move re-renders only the small readers whose answer changed.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { nextRedraw } from "../../../../data/broadcast/presentOdds";
import type { PresentationClock } from "../../../../data/broadcast/presentationClock";
import type { OddsLayout } from "../../../../data/odds/chart";
import { timeOf, type Domain, type MatchHistory } from "../../../../data/odds/history";
import type { TimelineMark } from "../../../../data/odds/marks";
import { OddsPointer, selectKeyPlay } from "../../../../data/odds/pointer";
import { destination, type TimelinePeriod } from "../../../../data/odds/timeline";
import { Icon, type IconName } from "../../../../design/components";
import type { OddsFeed } from "../../../../state/odds";
import { useLinkedStore, type Focus, type LinkedFocusStore } from "../linked";
import { pointSize } from "../useMedia";
import styles from "./Inspection.module.css";

// MARK: - The pointer

const PointerContext = createContext<OddsPointer | null>(null);

/** One pointer per game page (DetailView's `matchInspection`), shared by the timeline and Win Probability. */
export function PointerProvider({ pointer, children }: { pointer: OddsPointer; children: ReactNode }) {
  return <PointerContext.Provider value={pointer}>{children}</PointerContext.Provider>;
}

/** The page's pointer; outside a page (the render harness), one of its own. */
export function useOddsPointer(): OddsPointer {
  const shared = useContext(PointerContext);
  const own = useMemo(() => new OddsPointer(), []);
  return shared ?? own;
}

/** One value read from the pointer: the reader re-renders only when it changes. */
export function usePointer<T>(pointer: OddsPointer, select: (pointer: OddsPointer) => T): T {
  const read = () => select(pointer);
  return useSyncExternalStore(pointer.subscribe, read, read);
}

/** The page's linked focus as the pointer pins through it. */
function usePinTarget(): LinkedFocusStore | null {
  return useLinkedStore();
}

// MARK: - Rows to the moment (MatchFocusLink)

/**
 * Key plays' focus into the shared moment: a row hovered moves both charts'
 * line, a row pinned holds them there. The linked focus keeps its hover delay
 * and grace; nothing renders here.
 */
export function useFocusLink(history: MatchHistory | null, pointer: OddsPointer): void {
  const linked = useLinkedStore();
  const current = useRef(history);
  current.current = history;
  const sync = useRef<() => void>(() => {});
  useEffect(() => {
    if (!linked) return;
    const time = (focus: Focus | null) => {
      const h = current.current;
      return focus?.play != null && h ? timeOf(h, focus.play) : null;
    };
    let hovered: number | null | undefined;
    let pin: string | undefined;
    sync.current = () => {
      const t = time(linked.hovering());
      if (t !== hovered) {
        hovered = t;
        pointer.link(t);
      }
      const pinned = linked.pin();
      const at = time(pinned);
      const key = `${pinned?.play ?? ""}|${at ?? ""}`;
      if (key === pin) return;
      pin = key;
      if (at != null) pointer.pin(at, pinned?.play ?? null);
      else if (pointer.heldPlay != null) pointer.pin(null);
    };
    sync.current();
    const off = linked.subscribe(() => sync.current());
    return () => {
      off();
      sync.current = () => {};
      pointer.link(null);
    };
  }, [linked, pointer]);
  // A play just told (or a stamp corrected): the row's moment, where it is now.
  useEffect(() => sync.current(), [history]);
}

// MARK: - The presented time both modules read

/** `until` while the page broadcasts (epoch ms), the same value in both modules; null otherwise. */
export class PresentedTime {
  until: number | null = null;
  private clock: PresentationClock | null = null;
  private feed: OddsFeed | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private offFeed: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get = (): number | null => this.until;

  /** The page's presentation clock (republished on each re-plan) and its market. */
  configure(clock: PresentationClock | null, feed: OddsFeed | null): void {
    if (feed !== this.feed) {
      this.offFeed?.();
      this.feed = feed;
      // New ticks: p reaches a different next one.
      this.offFeed = feed ? feed.subscribe(() => this.refresh()) : null;
    }
    this.clock = clock;
    this.refresh();
  }

  /** p now, and the next redraw scheduled (none in a hidden tab: the page is asleep). */
  refresh = (): void => {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    const clock = this.clock;
    const now = Date.now();
    const until = clock ? clock.p(now / 1000) * 1000 : null;
    if (until !== this.until) {
      this.until = until;
      for (const l of [...this.listeners]) l();
    }
    if (!clock || (typeof document !== "undefined" && document.hidden)) return;
    const next = nextRedraw(this.feed?.ticks(until ?? now) ?? [], clock, now);
    this.timer = setTimeout(this.refresh, Math.max(next - now, 50));
  };

  dispose(): void {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    this.offFeed?.();
    this.offFeed = null;
  }
}

/** The page's presented time (one per page), configured with its clock and market. */
export function usePresentedTime(clock: PresentationClock | null, feed: OddsFeed | null): PresentedTime {
  const store = useMemo(() => new PresentedTime(), []);
  useEffect(() => {
    store.configure(clock, feed);
  }, [store, clock, feed]);
  useEffect(() => {
    const wake = () => store.refresh();
    document.addEventListener("visibilitychange", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      store.dispose();
    };
  }, [store]);
  return store;
}

export function useUntil(time: PresentedTime): number | null {
  return useSyncExternalStore(time.subscribe, time.get, time.get);
}

// MARK: - The inspection surface (MatchInspection)

export interface InspectionOptions {
  readonly layout: OddsLayout;
  readonly marks: readonly TimelineMark[];
  readonly pointer: OddsPointer;
  /** The key play under a location (in points), if any. */
  readonly markAt: (x: number, y: number) => TimelineMark | null;
}

/** Hover, click and keys over a plot, the same in both modules: handlers for the element whose box is the layout's bounds. */
export function useInspection(options: InspectionOptions) {
  const linked = usePinTarget();
  const latest = useRef(options);
  latest.current = options;
  return useMemo(() => {
    const local = (e: PointerEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pt = pointSize();
      return { x: (e.clientX - rect.left) / pt, y: (e.clientY - rect.top) / pt };
    };
    /** The moment under a location, on the plot; nothing can be read past now. */
    const moment = (x: number, y: number): number | null => {
      const { layout } = latest.current;
      const b = layout.bounds;
      if (y < b.y || y > b.y + b.height || x < layout.plot.x || x > layout.plot.x + layout.plot.width) return null;
      return layout.inspectionTime(x);
    };
    return {
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === "touch" && !e.isPrimary) return;
        const { x, y } = local(e);
        latest.current.pointer.hover(moment(x, y));
      },
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        // Touch: the finger reads (vertical swipes still scroll the page).
        if (e.pointerType !== "touch") return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const { x, y } = local(e);
        latest.current.pointer.hover(moment(x, y));
      },
      onPointerLeave: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType !== "touch") latest.current.pointer.hover(null);
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === "touch") latest.current.pointer.hover(null);
      },
      onPointerCancel: () => latest.current.pointer.hover(null),
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pt = pointSize();
        const x = (e.clientX - rect.left) / pt;
        const y = (e.clientY - rect.top) / pt;
        const t = moment(x, y);
        if (t == null) return;
        const { layout, pointer, markAt } = latest.current;
        const mark = markAt(x, y);
        pointer.toggle(mark?.t ?? t, mark?.moment.id ?? null, layout.domain, linked);
      },
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        // Tabbing in reads the latest, so the focus shows; a click is already a reading.
        if (e.currentTarget.matches(":focus-visible")) latest.current.pointer.key(latest.current.layout.readable.to);
      },
      onBlur: () => latest.current.pointer.key(null),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        const { layout, pointer, marks } = latest.current;
        const readable = layout.readable;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          const forward = e.key === "ArrowRight";
          if (e.altKey) selectKeyPlay(forward, marks, layout.domain, pointer, linked);
          else pointer.step(forward ? 0.01 : -0.01, readable, linked);
        } else if (e.key === "Home" || e.key === "End") {
          // A slider's ends (a web addition): the first and the last moment there is to read.
          const t = e.key === "Home" ? readable.from : readable.to;
          if (pointer.pinned) pointer.hold(t, null, linked);
          else pointer.key(t);
        } else if (e.key === "Enter" || e.key === " ") {
          const t = pointer.moment ?? readable.to;
          pointer.toggle(t, marks.find((m) => m.t === t)?.moment.id ?? null, layout.domain, linked);
        } else if (e.key === "Escape") {
          if (!pointer.back(linked)) return;
        } else {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }, [linked]);
}

/** What the inspection hint says (the Mac's accessibility hint for the odds' scrub). */
export const INSPECTION_HINT = "Left and right arrows move through the game. Option with an arrow moves between key plays. Return holds a moment. Escape returns to the latest.";

// MARK: - Controls

/** A small control in a chart's row: as tall as the text it sits beside, so nothing moves when it appears (PinButton). */
function PinButton({ icon, title, label, enabled = true, onClick }: { icon: IconName; title?: string; label: string; enabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.pinButton} aria-label={label} disabled={!enabled} onClick={onClick}>
      <Icon name={icon} size={9} />
      {title ? <span aria-hidden="true">{title}</span> : null}
    </button>
  );
}

/**
 * What a pin offers, only while there is one: the way through the key plays,
 * and back to the latest (MatchPinControls; the Mac's replay button waits for
 * the web's per-row replays).
 */
export function PinControls({ marks, range, pointer }: { marks: readonly TimelineMark[]; range: Domain | null; pointer: OddsPointer }) {
  const linked = usePinTarget();
  const held = usePointer(pointer, (p) => p.held);
  if (held == null) return null;
  const chevron = (forward: boolean) => (
    <PinButton
      icon={forward ? "chevronRight" : "chevronLeft"}
      label={forward ? "Next key play" : "Previous key play"}
      enabled={destination(forward, marks, held) != null}
      onClick={() => selectKeyPlay(forward, marks, range ?? { from: held, to: held }, pointer, linked)}
    />
  );
  return (
    <div className={styles.pin}>
      {chevron(false)}
      {chevron(true)}
      <PinButton icon="arrowUturnBackward" title="Latest" label="Return to latest" onClick={() => pointer.clear(linked)} />
    </div>
  );
}

/** While zoomed, the way back: the window's place in Win Probability's header (WholeGameLink). */
export function WholeGameLink({ pointer }: { pointer: OddsPointer }) {
  return <PinButton icon="arrowsExpand" title="Whole Game" label="Show the whole game" onClick={() => pointer.zoom(null, null)} />;
}

/**
 * The labels' row, as buttons: a period's zooms both modules to it; zoomed,
 * the row returns to the whole game. A wash says what a click takes in. Out
 * of the tab order (as on the Mac); screen readers reach them by name.
 */
export function PeriodRow({ spans, zoomed, pointer, top, height }: { spans: readonly TimelinePeriod[]; zoomed: boolean; pointer: OddsPointer; top: number; height: number }) {
  return (
    <div className={styles.periods} style={{ top: `calc(${top} * var(--pt))`, height: `calc(${height} * var(--pt))` }} data-zoomed={zoomed}>
      {spans.map((span) => (
        <button
          key={span.number}
          type="button"
          tabIndex={-1}
          className={styles.period}
          style={{ left: `calc(${span.x.from + 1} * var(--pt))`, width: `calc(${Math.max(span.x.to - span.x.from - 2, 1)} * var(--pt))` }}
          aria-label={zoomed ? "Show the whole game" : `Show ${span.label}`}
          onClick={() => pointer.zoom(zoomed ? null : span.number, zoomed ? null : span.time)}
        />
      ))}
    </div>
  );
}

// MARK: - Measuring

let measurer: CanvasRenderingContext2D | null = null;

/** A string's width in points at a size and weight of the system font (tabular figures are SF's own). */
export function textWidth(text: string, size: number, weight: number): number {
  if (typeof document === "undefined") return text.length * size * 0.6;
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * size * 0.6;
  measurer.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  return measurer.measureText(text).width;
}

/** The end labels' font: 10.5pt semibold. */
export const measureEndLabel = (text: string) => textWidth(text, 10.5, 600);
/** The axis labels' font: 9pt medium. */
export const measureAxisLabel = (text: string) => textWidth(text, 9, 500);
