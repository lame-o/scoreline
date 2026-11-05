/**
 * The plot in its well (OddsChart.swift `OddsPlot`, `OddsStill`, `OddsHead`,
 * `OddsPulse`, `OddsScrub`): one line per outcome on a fixed 0–100% scale,
 * each ending in a dot and a label that dodges its neighbors as a cluster.
 *
 * - The still layer (a canvas: the grid, every line up to its newest point)
 *   redraws when the data, the size or the colors change, never for a glide,
 *   a pulse or a scrub.
 * - The live ends (a canvas, the labels and the pulses): a new value glides
 *   in on one 0.5 s clock for every line, drawn by requestAnimationFrame and
 *   written straight to the labels' styles (React never renders per frame),
 *   then the loop stops. Every end pulses on one shared phase (CSS, the
 *   compositor's), and the outcome that just moved gets one brighter beat;
 *   a beat on a dot still gliding waits for it to land. While a moment is
 *   being read the live ends step back to 25%.
 * - The scrub: pointer and keys over the plot (core/odds/inspection.tsx), a
 *   1pt crosshair with a dot on every line; near a key play's column, the
 *   play. A move re-renders only the crosshair and the readers.
 *
 * Reduce Motion: still dots, and values just change.
 */
import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AXIS,
  beatAfter,
  drawnAt,
  drawnOrder,
  endOpacity,
  glideDone,
  glideValue,
  GLIDE_MS,
  hourLabels,
  LABEL_HEIGHT,
  labelWidth,
  mover,
  nextEndOrder,
  observedPoint,
  OddsLabelGlide,
  OddsLayout,
  percents,
  periodLabels,
  plotHeight,
  usesFinalPercentages,
  type OddsChartData,
  type OddsGlide,
  type OddsLine,
} from "../../../../data/odds/chart";
import type { TimelineMark } from "../../../../data/odds/marks";
import { share, type OddsSplit, type Outcome } from "../../../../data/odds/polymarket";
import type { OddsPointer } from "../../../../data/odds/pointer";
import { timelineSpans } from "../../../../data/odds/timeline";
import { NEUTRAL, type Scheme } from "../../../../data/teamColors";
import { colorResolver, fitCanvas } from "../canvasColors";
import { VizWell } from "../DetailSection";
import { nearest, useLinkedMarks } from "../linked";
import { pointSize, useReducedMotion } from "../useMedia";
import { drawHead, drawStill, type OddsInk } from "./drawOdds";
import { INSPECTION_HINT, measureAxisLabel, measureEndLabel, PeriodRow, useInspection, usePointer } from "./inspection";
import styles from "./Odds.module.css";

/** Every pulse breathes from this one moment, so dots never fall out of step. */
const EPOCH = typeof performance !== "undefined" ? performance.now() : 0;

const hourOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const wallTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export interface OddsPlotProps {
  readonly data: OddsChartData | null;
  /** In the legend's order. */
  readonly lines: readonly OddsLine[];
  readonly pointer: OddsPointer;
  readonly marks: readonly TimelineMark[];
  readonly spoken: { readonly top: string; readonly bottom: string };
  /** The market streams and the chart is seen: the ends pulse and beat. */
  readonly live: boolean;
  /** The section's width in points (the well's 8pt either side included). */
  readonly width: number;
  readonly scheme: Scheme;
}

const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);

export const OddsPlot = memo(function OddsPlot({ data, lines, pointer, marks, spoken, live, width, scheme }: OddsPlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const height = plotHeight(width);
  const inner = Math.max(width - 16, 1);
  const labelW = useMemo(() => labelWidth(lines.map((l) => l.name), measureEndLabel), [lines]);
  const layout = useMemo(() => (data ? new OddsLayout(inner, height, data.domain, labelW, data.now) : null), [data?.domain.from, data?.domain.to, data?.now, inner, height, labelW]); // eslint-disable-line react-hooks/exhaustive-deps
  const reading = usePointer(pointer, (p) => p.active);
  const ink = useMemo((): OddsInk | null => {
    if (typeof document === "undefined") return null;
    const resolve = colorResolver(document.body, scheme);
    return { grid: resolve("var(--viz-grid)"), line: (l) => resolve(css(l.color)) };
  }, [scheme]);

  const axis = useMemo(() => {
    if (!data || !layout) return [];
    return data.periods.length === 0 ? hourLabels(layout, (t) => hourOnly.format(t)) : periodLabels(data.periods, layout, measureAxisLabel);
  }, [data, layout]);

  return (
    <div className={styles.chart}>
      <VizWell padding={8}>
        <div ref={host} className={styles.plot} style={{ height: `calc(${height + AXIS} * var(--pt))` }}>
          {data && layout && ink ? (
            <>
              <Still data={data} layout={layout} lines={lines} ink={ink} />
              <div className={styles.axis} aria-hidden="true">
                {[1, 0.5, 0].map((p) => (
                  <span key={p} className={styles.gutterLabel} style={{ top: `calc(${layout.y(p)} * var(--pt))`, width: `calc(25 * var(--pt))` }}>
                    {`${Math.trunc(p * 100)}%`}
                  </span>
                ))}
                {axis.map((l) => (
                  <span key={`${l.label}-${l.x}`} className={styles.periodLabel} style={{ left: `calc(${l.x} * var(--pt))`, top: `calc(${height + 8} * var(--pt))` }}>
                    {l.label}
                  </span>
                ))}
              </div>
              {data.points.length > 0 && data.endVisible ? (
                <div className={styles.ends} style={{ opacity: reading ? 0.25 : 1 }} aria-hidden="true">
                  <Head data={data} layout={layout} lines={lines} live={live} ink={ink} />
                </div>
              ) : null}
              {data.points.length > 0 ? <Scrub data={data} layout={layout} lines={lines} marks={marks} pointer={pointer} /> : null}
              <PeriodRow spans={timelineSpans(data.periods, layout, data.now != null)} zoomed={data.zoomed} pointer={pointer} top={height} height={AXIS} />
            </>
          ) : null}
        </div>
      </VizWell>
      {data ? <OddsTable data={data} lines={lines} spoken={spoken} /> : null}
    </div>
  );
});

// MARK: Still layer

function Still({ data, layout, lines, ink }: { data: OddsChartData; layout: OddsLayout; lines: readonly OddsLine[]; ink: OddsInk }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = fitCanvas(el);
    if (!fit) return;
    const pt = pointSize();
    fit.ctx.scale(pt, pt);
    drawStill(fit.ctx, data, layout, lines, ink);
  }, [data, layout, lines, ink]);
  return <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />;
}

// MARK: Live ends

interface HeadState {
  glide: OddsGlide | null;
  labelGlide: OddsLabelGlide | null;
  order: Outcome[];
  moving: Set<Outcome>;
  raf: number;
  target: OddsSplit | null;
}

function Head({ data, layout, lines, live, ink }: { data: OddsChartData; layout: OddsLayout; lines: readonly OddsLine[]; live: boolean; ink: OddsInk }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef(new Map<Outcome, HTMLSpanElement>());
  const pulses = useRef(new Map<Outcome, HTMLSpanElement>());
  const reduce = useReducedMotion();
  const state = useRef<HeadState>({ glide: null, labelGlide: null, order: [], moving: new Set(), raf: 0, target: null });
  /** Ticks per outcome: each bump makes that dot's next beat the bright one. */
  const [beats, setBeats] = useState<Partial<Record<Outcome, { readonly count: number; readonly delay: number }>>>({});
  const target = data.points.at(-1)?.split ?? null;
  const outcomes = useMemo(() => lines.map((l) => l.outcome), [lines]);
  const values = target ? percents(target, data.final) : null;
  const latest = useRef({ data, layout, lines, ink, outcomes });
  latest.current = { data, layout, lines, ink, outcomes };

  /** One frame of the live ends at `time` (performance.now()): the canvas and the labels' places. */
  const paint = (time: number) => {
    const s = state.current;
    const { data: d, layout: l, lines: ls, ink: k, outcomes: os } = latest.current;
    const g = s.glide;
    const shown = g ? (glideDone(g, time) ? g.to : glideValue(g, time)) : s.target;
    const el = canvas.current;
    if (!shown || !el) return;
    const ordered = l.endLabels(shown, os, s.order.length > 0 ? s.order : null);
    const placed = s.labelGlide ? s.labelGlide.labels(time, ordered) : ordered;
    const fit = fitCanvas(el);
    if (fit) {
      const pt = pointSize();
      fit.ctx.scale(pt, pt);
      drawHead(fit.ctx, d, l, ls, shown, placed, k);
    }
    for (const label of placed) {
      const node = labels.current.get(label.outcome);
      if (!node) continue;
      node.style.transform = `translate(calc(${l.labelX} * var(--pt)), calc(${label.y - LABEL_HEIGHT / 2} * var(--pt)))`;
      node.style.opacity = String(endOpacity(label, placed));
    }
    for (const [outcome, node] of pulses.current) node.dataset.moving = String(g != null && s.moving.has(outcome));
  };

  // A new value: glide to it (OddsHead.moved), then stop.
  useLayoutEffect(() => {
    const s = state.current;
    const old = s.target;
    s.target = target;
    const now = performance.now();
    if (!old || !target || data.final) {
      cancelAnimationFrame(s.raf);
      s.glide = null;
      s.labelGlide = null;
      s.order = [];
      s.moving = new Set();
      paint(now);
      return;
    }
    if (sameSplit(old, target)) {
      paint(now);
      return;
    }
    // From what's on screen now, so a value arriving mid-glide never jumps.
    const from = s.glide ? glideValue(s.glide, now) : old;
    const oldOrder = s.order.length > 0 ? s.order : nextEndOrder([], old, outcomes, layout);
    const dots = layout.endLabels(from, outcomes, oldOrder);
    const fromLabels = s.labelGlide ? s.labelGlide.labels(now, dots) : dots;
    const order = nextEndOrder(oldOrder, target, outcomes, layout);
    const toLabels = layout.endLabels(target, outcomes, order);
    s.order = order;
    const travel = new Set(outcomes.filter((o) => Math.abs(layout.y(share(target, o)) - layout.y(share(from, o))) >= 1));
    // Most ticks move every dot less than a point: nothing to see glide, so no frames for it.
    if (!reduce && (s.glide != null || travel.size > 0)) {
      s.moving = s.glide == null ? travel : new Set([...s.moving, ...travel]);
      s.glide = { from, to: target, start: now };
      s.labelGlide = new OddsLabelGlide(fromLabels, toLabels, now);
      cancelAnimationFrame(s.raf);
      const frame = (t: number) => {
        paint(t);
        const g = state.current.glide;
        if (g && !glideDone(g, t)) {
          state.current.raf = requestAnimationFrame(frame);
        } else {
          state.current.glide = null;
          state.current.labelGlide = null;
          state.current.moving = new Set();
          paint(t);
        }
      };
      s.raf = requestAnimationFrame(frame);
    } else {
      paint(now);
    }
    const moved = live ? mover(old, target) : null;
    if (moved) {
      // The next ring after the dot lands, on the shared phase.
      const wait = s.glide != null && s.moving.has(moved) ? GLIDE_MS : 0;
      const delay = beatAfter(now + wait, EPOCH) - now;
      setBeats((b) => ({ ...b, [moved]: { count: (b[moved]?.count ?? 0) + 1, delay } }));
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new size or colors: drawn afresh, without a label glide (a new domain or now draws with its data).
  useLayoutEffect(() => {
    state.current.labelGlide = null;
    paint(performance.now());
  }, [layout.plot.width, layout.plot.height, layout.labelWidth, ink, lines]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => () => cancelAnimationFrame(state.current.raf), []);

  return (
    <>
      <canvas ref={canvas} className={styles.canvas} />
      {live && target
        ? lines.map((line) => {
            const end = layout.end(target, line.outcome);
            const beat = beats[line.outcome];
            return (
              <Pulse
                key={line.outcome}
                color={css(line.color)}
                x={end.x}
                y={end.y}
                beat={beat?.count ?? 0}
                delay={beat?.delay ?? 0}
                bind={(node) => (node ? pulses.current.set(line.outcome, node) : pulses.current.delete(line.outcome))}
              />
            );
          })
        : null}
      {lines.map((line) => (
        <span
          key={line.outcome}
          ref={(node) => {
            if (node) labels.current.set(line.outcome, node);
            else labels.current.delete(line.outcome);
          }}
          className={styles.endLabel}
          style={{ width: `calc(${layout.labelWidth} * var(--pt))` }}
        >
          <span style={{ color: css(line.color) }}>{line.name}</span>
          <span className={styles.endValue}>{values?.[line.outcome] != null ? `${values[line.outcome]}%` : "–"}</span>
        </span>
      ))}
    </>
  );
}

const sameSplit = (a: OddsSplit, b: OddsSplit) => a.top === b.top && a.draw === b.draw && a.bottom === b.bottom;

/**
 * A live end's pulse: a ring growing from the dot to 22pt and fading, every
 * 1.6 s, on one clock for every pulse. A tick makes the next ring the bright
 * one: stronger, with a faint fill (OddsPulse). CSS animations, so the
 * compositor runs them and React never re-renders for them.
 */
function Pulse({ color, x, y, beat, delay, bind }: { color: string; x: number; y: number; beat: number; delay: number; bind: (node: HTMLSpanElement | null) => void }) {
  const ring = useRef<HTMLSpanElement>(null);
  // On the shared phase from the first frame it shows.
  useLayoutEffect(() => {
    if (ring.current) ring.current.style.animationDelay = `${-((performance.now() - EPOCH) % 1600)}ms`;
  }, []);
  return (
    <span ref={bind} className={styles.pulse} style={{ transform: `translate(calc(${x} * var(--pt)), calc(${y} * var(--pt)))`, color } as CSSProperties}>
      <span ref={ring} className={styles.ring} />
      {beat > 0 ? <span key={beat} className={styles.beat} style={{ animationDelay: `${delay}ms` }} /> : null}
    </span>
  );
}

// MARK: Scrub

function Scrub({ data, layout, lines, marks, pointer }: { data: OddsChartData; layout: OddsLayout; lines: readonly OddsLine[]; marks: readonly TimelineMark[]; pointer: OddsPointer }) {
  const hintID = useId();
  // The key plays, as columns: a click or a hover near one takes the play.
  const placed = useMemo(() => marks.filter((m) => m.t != null && m.t >= layout.domain.from && m.t <= layout.domain.to), [marks, layout]);
  const columns = useMemo(() => placed.map((m) => ({ x: layout.x(m.t!), y: layout.plot.y, x2: layout.x(m.t!), y2: layout.plot.y + layout.plot.height })), [placed, layout]);
  const pt = typeof document === "undefined" ? 1 : pointSize();
  const hover = useLinkedMarks(
    columns.map((c) => ({ x: c.x * pt, y: c.y * pt, x2: c.x2 * pt, y2: c.y2 * pt })),
    (i) => ({ play: placed[i]!.moment.id }),
  );
  const inspection = useInspection({
    layout,
    marks,
    pointer,
    markAt: (x, y) => {
      const i = nearest(columns, x, y);
      return i != null ? placed[i]! : null;
    },
  });
  const moment = usePointer(pointer, (p) => p.moment);
  const pinned = usePointer(pointer, (p) => p.pinned);
  const active = usePointer(pointer, (p) => p.active);
  const value = scrubReading(data, lines, moment, pinned, active);
  return (
    <div
      className={styles.scrub}
      style={{ height: `calc(${layout.bounds.height} * var(--pt))` }}
      role="slider"
      tabIndex={0}
      aria-label="Inspect win probability"
      aria-describedby={hintID}
      aria-valuemin={0}
      aria-valuemax={Math.round((layout.readable.to - layout.domain.from) / 60_000)}
      aria-valuenow={Math.round(((moment ?? layout.readable.to) - layout.domain.from) / 60_000)}
      aria-valuetext={value}
      data-part="scrub"
      {...inspection}
      onPointerMove={(e) => {
        inspection.onPointerMove(e);
        hover.onPointerMove(e);
      }}
      onPointerLeave={(e) => {
        inspection.onPointerLeave(e);
        hover.onPointerLeave();
      }}
    >
      {moment != null && moment >= layout.domain.from && moment <= layout.domain.to ? <Crosshair x={layout.x(moment)} split={drawnAt(data, moment)} layout={layout} lines={lines} /> : null}
      <p id={hintID} className="visually-hidden">
        {INSPECTION_HINT}
      </p>
    </div>
  );
}

/** The crosshair: a 1pt rule and a dot on every line where it's drawn. */
function Crosshair({ x, split, layout, lines }: { x: number; split: OddsSplit | null; layout: OddsLayout; lines: readonly OddsLine[] }) {
  return (
    <>
      <span className={styles.rule} data-part="rule" style={{ transform: `translateX(calc(${x} * var(--pt)))`, top: `calc(${layout.plot.y - 6} * var(--pt))`, height: `calc(${layout.plot.height + 12} * var(--pt))` }} aria-hidden="true" />
      {split
        ? drawnOrder(lines).map((line) => (
            <span key={line.outcome} className={styles.mark} style={{ transform: `translate(calc(${x} * var(--pt)), calc(${layout.y(share(split, line.outcome))} * var(--pt)))`, background: css(line.color) }} aria-hidden="true" />
          ))
        : null}
    </>
  );
}

/** "Held, 7:42 PM. GSW, 62 percent. MIN, 38 percent." (OddsScrubAccessibility.reading) */
export function scrubReading(data: OddsChartData, lines: readonly OddsLine[], moment: number | null, pinned: boolean, active: boolean): string {
  const at = moment ?? data.now ?? data.domain.to;
  const state = pinned ? "Held" : active ? "" : "Latest";
  const lead = [state, wallTime.format(at)].filter((x) => x !== "").join(", ");
  const sample = observedPoint(data, at);
  if (!sample) return `${lead}. No odds at this moment.`;
  const p = percents(sample.split, usesFinalPercentages(data, moment));
  return `${lead}. ${lines.map((l) => `${l.name}, ${p[l.outcome] ?? 0} percent`).join(". ")}.`;
}

// MARK: Accessibility

/**
 * The chart as data for screen readers (OddsChartDescriptor's role on the
 * web: VoiceOver's audio graph has no web equivalent): each period's start
 * and the latest, every outcome's chance then, and ESPN's model.
 */
function OddsTable({ data, lines, spoken }: { data: OddsChartData; lines: readonly OddsLine[]; spoken: { top: string; bottom: string } }) {
  const end = data.now ?? data.domain.to;
  const moments = [...data.periods.filter((p) => p.start >= data.domain.from && p.start <= data.domain.to).map((p) => ({ t: p.start, label: `Start of ${p.label}` })), { t: end, label: "Latest" }];
  const name = (o: Outcome) => (o === "top" ? spoken.top : o === "bottom" ? spoken.bottom : "Draw");
  return (
    <table className="visually-hidden">
      <caption>Win probability over the game</caption>
      <thead>
        <tr>
          <th scope="col">Moment</th>
          {lines.map((l) => (
            <th key={l.outcome} scope="col">{`${name(l.outcome)}, Polymarket`}</th>
          ))}
          {data.espn.length > 0 ? <th scope="col">{`${spoken.top}, ESPN`}</th> : null}
        </tr>
      </thead>
      <tbody>
        {moments.map((m) => {
          const sample = observedPoint(data, m.t);
          const p = sample ? percents(sample.split, data.final && m.label === "Latest") : null;
          let espn: number | null = null;
          for (const w of data.espn) if (w.t <= m.t) espn = w.top;
          return (
            <tr key={`${m.label}-${m.t}`}>
              <th scope="row">{`${m.label}, ${wallTime.format(m.t)}`}</th>
              {lines.map((l) => (
                <td key={l.outcome}>{p?.[l.outcome] != null ? `${p[l.outcome]}%` : "–"}</td>
              ))}
              {data.espn.length > 0 ? <td>{espn != null ? `${Math.min(Math.max(Math.round(espn * 100), 1), 99)}%` : "–"}</td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
