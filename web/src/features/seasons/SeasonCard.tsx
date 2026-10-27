/**
 * The season pages' summary (SeasonCard.swift, SeasonTimeline.swift): a
 * glass card at the top with what's on (live, next, done) and the season on
 * one axis, the readout of the competition under the pointer beneath it. As
 * the page scrolls the card tucks under the header and, at the same offsets,
 * a compact bar docks in its place: the summary on one line over a slim
 * strip of the season, as the match page's hero gives way to its scorebar.
 *
 * Both are driven by the scroll position (`useSeasonDock`): one passive,
 * rAF-throttled listener reads the scroll offset against measurements made
 * on resize, quantizes the dock to 1/64 steps and writes transform and
 * opacity straight onto the two elements. No timers, no React state per
 * frame, no layout reads while scrolling. The bar hangs from the sticky
 * header (an overlay: the page's height never sees it).
 *
 * The strip is live: hovering a mark lights its row in the list (and the row
 * lights the mark), clicking one opens it and scrolls its row up to just
 * under the bar.
 */
import { memo, useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { LiveDot } from "../../design/components";
import { useWidth } from "../../design/useWidth";
import { compareDays, dayRangeLabel, longDayLabel, monthLabel } from "../../data/days";
import type { SeasonEvent } from "../../data/schedule";
import {
  barMotion,
  dockLine,
  dockProgress,
  dockStrip,
  DOCK,
  heroTuck,
  monthsOf,
  readout,
  TIMELINE,
  timelineDomain,
  timelineHit,
  timelineLayout,
  timelineX,
  type Mark,
  type SeasonAxis,
  type SeasonSummary,
} from "../../data/seasons";
import { useHovered, type HoverStore } from "./hover";
import styles from "./SeasonCard.module.css";

// MARK: - The card

export interface SeasonCardProps {
  readonly summary: SeasonSummary;
  readonly axis: SeasonAxis;
  readonly hover: HoverStore;
  readonly onSelect: (id: string) => void;
  /** Beside the summary while something's live (Bracket, Watch). */
  readonly accessory?: ReactNode;
  readonly cardRef?: RefObject<HTMLDivElement | null>;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/** The glass card at the top of a season page: the summary, the timeline and its readout. */
export function SeasonCard({ summary, axis, hover, onSelect, accessory, cardRef, className, style }: SeasonCardProps) {
  return (
    <section ref={cardRef} className={[styles.card, className].filter(Boolean).join(" ")} style={style} aria-label="Season">
      <div className={styles.headlineRow}>
        <SeasonHeadline summary={summary} />
        {accessory ? <div className={styles.accessory}>{accessory}</div> : null}
      </div>
      <SeasonTimeline axis={axis} hover={hover} onSelect={onSelect} />
      <Readout axis={axis} hover={hover} />
    </section>
  );
}

function SeasonHeadline({ summary }: { summary: SeasonSummary }) {
  return (
    <div className={styles.headline}>
      <h2 className={styles.headlineText}>
        {summary.live ? <LiveDot /> : null}
        <span>{summary.headline}</span>
      </h2>
      {summary.subline ? <p className={[styles.subline, summary.sublineLive ? styles.liveText : null].filter(Boolean).join(" ")}>{summary.subline}</p> : null}
    </div>
  );
}

/** Hovering re-renders this line, not the card or the page. */
function Readout({ axis, hover }: { axis: SeasonAxis; hover: HoverStore }) {
  const hovered = useHovered(hover);
  const text = readout(axis, hovered);
  return (
    <p className={styles.readout} aria-live="off">
      {text ?? " "}
    </p>
  );
}

// MARK: - The timeline

/** The fill for a competition's mark: color only says state (finished, upcoming, next, live). */
function markClass(e: SeasonEvent | undefined, next: string | null): string {
  if (!e) return styles.markUpcoming!;
  switch (e.status) {
    case "live":
      return styles.markLive!;
    case "finished":
      return styles.markFinished!;
    case "canceled":
      return styles.markCanceled!;
    case "upcoming":
      return e.id === next ? styles.markNext! : styles.markUpcoming!;
  }
}

const BIG = new Set(["World Championships", "Major", "Olympic Games"]);

function timelineSummary(axis: SeasonAxis): string {
  const first = axis.events[0];
  const last = axis.events[axis.events.length - 1];
  if (!first || !last) return "No events";
  let text = `${axis.events.length} events, ${longDayLabel(first.startDay)} to ${longDayLabel(last.endDay)}`;
  const next = axis.events.find((e) => e.id === axis.next);
  if (next) text += `. Next: ${next.shortName}, ${dayRangeLabel(next.startDay, next.endDay)}`;
  return text;
}

/**
 * A season on one time axis: one lane per discipline (climbing) or a single
 * S-Tier lane (CS2), each competition a short capsule from its first day to
 * its last. Position says when, the lane label says what; color only says
 * state. One SVG, one hover target.
 */
export const SeasonTimeline = memo(function SeasonTimeline({ axis, hover, onSelect }: { axis: SeasonAxis; hover: HoverStore; onSelect: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 320);
  const hovered = useHovered(hover);
  const plot = Math.max(width - TIMELINE.labelWidth, 10);
  const domain = timelineDomain(axis.events, axis.today);
  const marks = timelineLayout(axis.events, axis.lanes, domain, plot);
  const height = axis.lanes.length * TIMELINE.laneHeight + TIMELINE.axisHeight;
  const axisY = axis.lanes.length * TIMELINE.laneHeight;
  const byID = new Map(axis.events.map((e) => [e.id, e]));
  const showToday = compareDays(domain[0], axis.today) <= 0 && compareDays(axis.today, domain[1]) <= 0;
  const hit = useHitTest(box, marks, TIMELINE.labelWidth, TIMELINE.laneHeight);

  return (
    <div ref={box} className={styles.timeline}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        style={{ height: `calc(${height} * var(--pt))` }}
        role="img"
        aria-label={timelineSummary(axis)}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const id = hit(e.clientX, e.clientY);
          if (id) hover.set(id);
          else if (hover.id && !hover.keyboard) hover.set(null);
        }}
        onPointerLeave={() => {
          if (!hover.keyboard && hover.id) hover.set(null);
        }}
        onClick={(e) => {
          const id = hit(e.clientX, e.clientY);
          if (id) onSelect(id);
        }}
      >
        {monthsOf(domain).map((m) => {
          const x = TIMELINE.labelWidth + timelineX(m, domain, plot);
          return (
            <g key={`${m.year}-${m.month}`}>
              <line className={styles.tick} x1={x} x2={x} y1={0} y2={axisY} />
              <text className={styles.axisLabel} x={x + 3} y={axisY + 11}>
                {monthLabel(m.month, "short", m.year)}
              </text>
            </g>
          );
        })}
        {axis.lanes.map((lane, i) => (
          <text key={lane.id} className={styles.laneLabel} x={0} y={i * TIMELINE.laneHeight + TIMELINE.laneHeight / 2 + 3.5}>
            {lane.label}
          </text>
        ))}
        {showToday ? (
          <line className={styles.today} x1={TIMELINE.labelWidth + timelineX(axis.today, domain, plot) + 0.5} x2={TIMELINE.labelWidth + timelineX(axis.today, domain, plot) + 0.5} y1={0} y2={axisY} />
        ) : null}
        {marks.map((m) => {
          const e = byID.get(m.event);
          const x = TIMELINE.labelWidth + m.x;
          const r = TIMELINE.markHeight / 2;
          return (
            <g key={`${m.lane}-${m.event}`}>
              <rect className={markClass(e, axis.next)} x={x} y={m.y} width={m.width} height={m.height} rx={r} />
              {e?.badge && BIG.has(e.badge) ? <rect className={styles.badgeRing} x={x - 1.5} y={m.y - 1.5} width={m.width + 3} height={m.height + 3} rx={r + 1.5} /> : null}
              {m.event === hovered || m.event === axis.selected ? <rect className={styles.ring} x={x - 2.5} y={m.y - 2.5} width={m.width + 5} height={m.height + 5} rx={r + 2.5} /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
});

/** Point → mark, in the SVG's point space. */
function useHitTest(box: RefObject<HTMLElement | null>, marks: readonly Mark[], left: number, laneHeight: number) {
  return useCallback(
    (clientX: number, clientY: number) => {
      const el = box.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const pt = pointSize();
      return timelineHit(marks, (clientX - rect.left) / pt - left, (clientY - rect.top) / pt, laneHeight);
    },
    [box, marks, left, laneHeight],
  );
}

// MARK: - The docked bar

export interface SeasonDockBarProps {
  readonly summary: SeasonSummary;
  readonly axis: SeasonAxis;
  readonly hover: HoverStore;
  readonly onSelect: (id: string) => void;
  readonly barRef: RefObject<HTMLDivElement | null>;
  readonly onTop: () => void;
}

/**
 * The card, docked: the summary on one line (the readout of whatever's under
 * the pointer, when something is) over a slim strip of the whole season.
 * Clicking the line goes back to the top. Hidden from assistive tech: the
 * card stays the canonical element.
 */
export const SeasonDockBar = memo(function SeasonDockBar({ summary, axis, hover, onSelect, barRef, onTop }: SeasonDockBarProps) {
  return (
    <div className={styles.dockSlot}>
      <div ref={barRef} className={styles.bar} aria-hidden="true" data-docked="false">
        <button type="button" className={styles.barLine} tabIndex={-1} title="Back to top" onClick={onTop}>
          <DockLine summary={summary} axis={axis} hover={hover} />
        </button>
        <SeasonStrip axis={axis} hover={hover} onSelect={onSelect} />
      </div>
    </div>
  );
});

function DockLine({ summary, axis, hover }: { summary: SeasonSummary; axis: SeasonAxis; hover: HoverStore }) {
  const hovered = useHovered(hover);
  const line = dockLine(summary, hovered, axis);
  return (
    <span className={styles.dockLine}>
      {summary.live && line.trail != null ? <LiveDot /> : null}
      <span className={[styles.dockLead, line.trail == null ? styles.dockLeadPlain : null].filter(Boolean).join(" ")}>{line.lead}</span>
      {line.trail ? <span className={[styles.dockTrail, summary.sublineLive ? styles.liveText : null].filter(Boolean).join(" ")}>{line.trail}</span> : null}
    </span>
  );
}

/** The season on one slim lane: every competition a mark, today a hairline, colored by state as the timeline is. */
function SeasonStrip({ axis, hover, onSelect }: { axis: SeasonAxis; hover: HoverStore; onSelect: (id: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 300);
  const hovered = useHovered(hover);
  const domain = timelineDomain(axis.events, axis.today);
  const marks = dockStrip(axis.events, domain, width);
  const byID = new Map(axis.events.map((e) => [e.id, e]));
  const showToday = compareDays(domain[0], axis.today) <= 0 && compareDays(axis.today, domain[1]) <= 0;
  const hit = useHitTest(box, marks, 0, DOCK.stripHeight);
  return (
    <div ref={box} className={styles.strip}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${DOCK.stripHeight}`}
        style={{ height: `calc(${DOCK.stripHeight} * var(--pt))` }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const id = hit(e.clientX, e.clientY);
          if (id !== hover.id) hover.set(id);
        }}
        onPointerLeave={() => {
          if (!hover.keyboard && hover.id) hover.set(null);
        }}
        onClick={(e) => {
          const id = hit(e.clientX, e.clientY);
          if (id) onSelect(id);
        }}
      >
        {monthsOf(domain).map((m) => {
          const x = timelineX(m, domain, width);
          return x > 0 ? <line key={`${m.year}-${m.month}`} className={styles.stripTick} x1={x} x2={x} y1={1} y2={DOCK.stripHeight - 1} /> : null;
        })}
        {showToday ? <line className={styles.today} x1={timelineX(axis.today, domain, width) + 0.5} x2={timelineX(axis.today, domain, width) + 0.5} y1={0} y2={DOCK.stripHeight} /> : null}
        {marks.map((m) => {
          const r = DOCK.stripMark / 2;
          return (
            <g key={m.event}>
              <rect className={markClass(byID.get(m.event), axis.next)} x={m.x} y={m.y} width={m.width} height={m.height} rx={r} />
              {m.event === hovered || m.event === axis.selected ? <rect className={styles.stripRing} x={m.x - 2} y={m.y - 2} width={m.width + 4} height={m.height + 4} rx={r + 2} /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// MARK: - The dock (PageGeometry, DockedBarHost, HeroTuck)

/** The page's scroller: the split view's detail pane, else the window. */
export function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  const main = el?.closest("main");
  if (main && /(auto|scroll)/.test(getComputedStyle(main).overflowY)) return main;
  return null;
}

function pointSize(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
}

/** Scrolls the page so `el`'s top sits `inset` points under the sticky header (a mark clicked in the docked bar). */
export function scrollUnderBar(el: HTMLElement, header: HTMLElement | null, smooth: boolean) {
  const scroller = scrollerOf(el);
  const pt = pointSize();
  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const delta = el.getBoundingClientRect().top - headerBottom - DOCK.reserve * pt;
  const behavior: ScrollBehavior = smooth ? "smooth" : "instant";
  if (scroller) scroller.scrollBy({ top: delta, behavior });
  else window.scrollBy({ top: delta, behavior });
}

export function scrollToTop(from: HTMLElement | null, smooth: boolean) {
  const scroller = scrollerOf(from);
  const behavior: ScrollBehavior = smooth ? "smooth" : "instant";
  if (scroller) scroller.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}

/**
 * Drives the card's tuck and the bar's dock from the scroll position. The
 * header is the bar's slot's parent (the bar hangs from the sticky header).
 * The bar takes clicks from half docked (`data-docked`).
 */
export function useSeasonDock(card: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, ready: boolean) {
  useLayoutEffect(() => {
    const cardEl = card.current;
    const barEl = bar.current;
    if (!ready || !cardEl || !barEl) return;
    const header = barEl.parentElement?.parentElement ?? null;
    const scroller = scrollerOf(cardEl);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let cardTop = 0;
    let cardHeight = 1;
    let headerHeight = 0;
    let pt = 1;
    let frame = 0;
    let last = { tuckKey: -1, p: -1 };

    const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY);
    const measure = () => {
      pt = pointSize();
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      cardTop = cardEl.getBoundingClientRect().top - scrollerTop + scrollTop();
      cardHeight = cardEl.offsetHeight || 1;
      headerHeight = header ? header.offsetHeight : 0;
      last = { tuckKey: -1, p: -1 };
      apply();
    };
    const apply = () => {
      frame = 0;
      // How far the card has slid under the header, in points (0: its top meets the header's bottom, less the 4pt inset).
      const under = (scrollTop() + headerHeight + 4 * pt - cardTop) / pt;
      const height = cardHeight / pt;
      const tuck = heroTuck(under, height);
      const tuckKey = Math.round(tuck.scale * 2000) * 1000 + Math.round(tuck.opacity * 200);
      if (tuckKey !== last.tuckKey) {
        last.tuckKey = tuckKey;
        cardEl.style.transform = reduce.matches || tuck.scale === 1 ? "" : `scale(${tuck.scale.toFixed(4)})`;
        cardEl.style.opacity = tuck.opacity === 1 ? "" : tuck.opacity.toFixed(3);
      }
      const p = dockProgress(under, height);
      if (p !== last.p) {
        last.p = p;
        const m = barMotion(p);
        barEl.style.visibility = p > 0 ? "visible" : "hidden";
        barEl.style.opacity = m.opacity.toFixed(3);
        barEl.style.transform = reduce.matches ? "" : `translateY(calc(${m.offset.toFixed(2)} * var(--pt))) scale(${m.scale.toFixed(4)})`;
        barEl.dataset.docked = String(m.interactive);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(cardEl);
    if (header) observer.observe(header);
    if (scroller) observer.observe(scroller);
    reduce.addEventListener("change", measure);
    measure();
    return () => {
      target.removeEventListener("scroll", onScroll);
      observer.disconnect();
      reduce.removeEventListener("change", measure);
      if (frame) cancelAnimationFrame(frame);
      cardEl.style.transform = "";
      cardEl.style.opacity = "";
    };
  }, [card, bar, ready]);
}
