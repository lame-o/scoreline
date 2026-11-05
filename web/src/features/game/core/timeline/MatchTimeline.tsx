/**
 * One timeline for every sport, and it's soccer's (MatchTimeline.swift): one
 * track, each team's marks in its own lane (labeled), the game's landmarks
 * under it. Only the axis differs (data/odds/timeline.ts): match minutes when
 * that's all a provider gives, else the wall clock it shares with Win
 * Probability, so a goal sits above the odds it moved. Hover and pin read
 * the same moment in both (core/odds/inspection.tsx); a key play's row, its
 * mark and its column in the odds are one focus (core/linked.tsx).
 *
 * SVG: thirty-odd marks, redrawn only when the data, the width or the focus
 * changes. The reading's rule and the slider's value are small readers of
 * the pointer, so a move re-renders only them. On match minutes the now dot
 * and the played fill glide as the minute turns (Motion.standard).
 */
import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DetailMoment } from "../../../../data/gameDetail";
import { maxX, type OddsLayout } from "../../../../data/odds/chart";
import type { Domain, MatchHistory, OddsWindow } from "../../../../data/odds/history";
import { momentHeadline, type TimelineMark } from "../../../../data/odds/marks";
import type { OddsPointer } from "../../../../data/odds/pointer";
import {
  axisX,
  laneY,
  minutesAxis,
  readingValue,
  TIMELINE_GUTTER,
  TIMELINE_HEIGHT,
  TIMELINE_PLOT_HEIGHT,
  timelineSpans,
  timelineSpoken,
  wallAxis,
  type TimelineAxis,
} from "../../../../data/odds/timeline";
import { NEUTRAL } from "../../../../data/teamColors";
import { fitted, useLabelGutter } from "../chartLabels";
import { nearest, useFocus, useLinkedMarks } from "../linked";
import { INSPECTION_HINT, measureAxisLabel, PeriodRow, PinControls, useInspection, usePointer } from "../odds/inspection";
import { pointSize, useReducedMotion } from "../useMedia";
import styles from "./Timeline.module.css";

/** The axis a timeline draws on (MatchTimeline.Scale). */
export type TimelineScale =
  /** Match minutes: no timestamps to align with anything. */
  | { readonly kind: "minutes"; readonly current: number | null }
  /** The wall clock it shares with Win Probability: as presented (nothing past p), on the odds' own domain. */
  | { readonly kind: "wall"; readonly history: MatchHistory; readonly domain: Domain; readonly now: number | null; readonly labelWidth: number; readonly window: OddsWindow };

export interface MatchTimelineProps {
  readonly marks: readonly TimelineMark[];
  readonly scale: TimelineScale;
  readonly topColor: string;
  readonly bottomColor: string;
  readonly topName: string;
  readonly bottomName: string;
  readonly pointer: OddsPointer;
  /** Nothing else on the page holds the pin's controls (Win Probability isn't on it). */
  readonly showsPinControls?: boolean;
}

const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);

export const MatchTimeline = memo(function MatchTimeline({ marks, scale, topColor, bottomColor, topName, bottomName, pointer, showsPinControls = false }: MatchTimelineProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const reduce = useReducedMotion();
  const hintID = useId();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth / pointSize());
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const wall = scale.kind === "wall" ? scale : null;
  // From large up (the section's width, the well's 8pt either side included on the wall clock).
  const large = width + (wall ? 16 : 0) >= 460;
  // Long names grow the gutter on match minutes; the wall clock keeps the odds' 30pt so the two align.
  const grown = useLabelGutter(topName, bottomName);
  const gutter = wall ? TIMELINE_GUTTER : grown;
  const axis: TimelineAxis = useMemo(
    () => (wall ? wallAxis(wall, Math.max(width, 1), large, measureAxisLabel) : minutesAxis(width, marks, scale.kind === "minutes" ? scale.current : null, large, gutter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wall?.history, wall?.domain.from, wall?.domain.to, wall?.now, wall?.labelWidth, wall?.window, width, large, marks, scale.kind === "minutes" ? scale.current : null, gutter],
  );
  const placed = useMemo(() => marks.flatMap((mark) => {
    const x = axisX(axis, mark);
    return x != null ? [{ mark, x, y: laneY(mark.moment) }] : [];
  }), [axis, marks]);

  const pt = typeof document === "undefined" ? 1 : pointSize();
  const hover = useLinkedMarks(
    placed.map((p) => ({ x: p.x * pt, y: p.y * pt })),
    (i) => ({ play: placed[i]!.mark.moment.id }),
  );
  const focusID = useFocus((f) => f?.play ?? null);
  const target = focusID ? (placed.find((p) => p.mark.moment.id === focusID) ?? null) : null;
  const layout = axis.layout;
  const inspection = useInspection({
    layout: layout ?? (null as unknown as OddsLayout),
    marks,
    pointer,
    markAt: (x, y) => {
      const i = nearest(placed, x, y);
      return i != null ? placed[i]!.mark : null;
    },
  });

  const top = fitted(topName, gutter - 6);
  const bottom = fitted(bottomName, gutter - 6);
  const color = (m: DetailMoment) => css(m.side === "bottom" ? bottomColor : topColor);
  const spoken = timelineSpoken(marks, scale.kind === "minutes" ? scale.current : null, wall);
  const w = Math.max(width, 1);

  const chart = (
    <svg className={styles.svg} viewBox={`0 0 ${w} ${TIMELINE_HEIGHT}`} data-animate={!wall && !reduce} aria-hidden="true">
      {[
        { fit: top, name: topName, y: 10 },
        { fit: bottom, name: bottomName, y: 38 },
      ].map(({ fit, name, y }) => (
        <text key={y} className={styles.team} x={gutter / 2 - 2} y={y} style={fit.size !== 9 ? { fontSize: fit.size } : undefined}>
          {fit.cut ? <title>{name}</title> : null}
          {fit.text}
        </text>
      ))}
      <rect className={styles.track} x={axis.track.from} y={23} width={Math.max(axis.track.to - axis.track.from, 0)} height={2} rx={1} />
      {axis.tinted.map((s) => (
        <rect key={`t${s.from}`} className={styles.extra} x={s.from} y={23} width={s.to - s.from} height={2} />
      ))}
      {axis.ticks.map((x) => (
        <rect key={`k${x}`} className={styles.tick} x={x - 0.5} y={22} width={1} height={4} />
      ))}
      {!wall && axis.played[0] ? (
        // Match minutes: the fill glides as the minute turns (a transform, from the track's start).
        <rect className={styles.played} x={axis.track.from} y={23} width={Math.max(axis.track.to - axis.track.from, 1)} height={2} style={{ transform: `scaleX(${(axis.played[0].to - axis.track.from) / Math.max(axis.track.to - axis.track.from, 1)})`, transformOrigin: `${axis.track.from}px 24px` }} />
      ) : (
        axis.played.map((s) => <rect key={`p${s.from}`} className={styles.played} x={s.from} y={23} width={s.to - s.from} height={2} />)
      )}
      {axis.landmarks.map((x) => (
        <line key={`l${x}`} className={styles.half} x1={x} y1={19} x2={x} y2={29} />
      ))}
      {/* The track stops short of the now dot on both sides. */}
      {axis.now != null ? <circle className={styles.ring} cx={0} cy={24} r={4.5} style={{ transform: `translateX(${axis.now}px)` }} /> : null}
      <g className={styles.marks} data-receded={target != null}>
        {/* Cards first; each goal clears room around it (a page-colored edge). */}
        {[...placed].sort((a, b) => Number(round(a.mark.moment)) - Number(round(b.mark.moment))).map((p) => (
          <Mark key={p.mark.moment.id} m={p.mark.moment} x={p.x} color={color(p.mark.moment)} emphasized={false} />
        ))}
      </g>
      {axis.now != null ? <circle className={styles.now} cx={0} cy={24} r={3} style={{ transform: `translateX(${axis.now}px)` }} /> : null}
      {target ? <Mark m={target.mark.moment} x={target.x} color={color(target.mark.moment)} emphasized /> : null}
      <g className={styles.labels} data-hidden={target != null}>
        {axis.labels.map((l) => (
          <text key={`${l.text}-${l.x}`} className={l.quiet ? styles.quarter : styles.landmark} x={l.x} y={54} textAnchor="middle">
            {l.text}
          </text>
        ))}
      </g>
    </svg>
  );

  return (
    <div className={styles.timeline} data-wall={wall != null}>
      <Surface
        box={box}
        pointer={pointer}
        marks={marks}
        layout={layout}
        label={spoken}
        hintID={hintID}
        handlers={
          layout
            ? {
                ...inspection,
                onPointerMove: (e) => {
                  inspection.onPointerMove(e);
                  hover.onPointerMove(e);
                },
                onPointerLeave: (e) => {
                  inspection.onPointerLeave(e);
                  hover.onPointerLeave();
                },
              }
            : hover
        }
      >
        {width > 0 ? chart : null}
        {layout ? <TimelineRule layout={layout} pointer={pointer} /> : null}
        {target ? (
          <p className={styles.readout} style={{ left: `calc(${gutter} * var(--pt))` }} aria-hidden="true">
            <strong>{target.mark.moment.clock}</strong>
            {`  ${momentHeadline(target.mark.moment)}`}
          </p>
        ) : null}
      </Surface>
      {wall && layout ? (
        <PeriodRow spans={timelineSpans(wall.history.periods, layout, wall.now != null)} zoomed={wall.window.kind === "period"} pointer={pointer} top={TIMELINE_PLOT_HEIGHT + 1} height={TIMELINE_HEIGHT - TIMELINE_PLOT_HEIGHT - 1} />
      ) : null}
      {wall && showsPinControls ? (
        <div className={styles.pinRow}>
          <PinControls marks={marks} range={wall.domain} pointer={pointer} section="timeline" />
        </div>
      ) : null}
      {layout ? (
        <p id={hintID} className="visually-hidden">
          {`Adjust to move through the game. ${INSPECTION_HINT}`}
        </p>
      ) : null}
    </div>
  );
});

/** A goal or a score draws round; cards and turnovers as cards. */
const round = (m: DetailMoment) => m.kind === "goal" || m.kind === "ownGoal" || m.kind === "score";

type Handlers = Partial<Pick<React.HTMLAttributes<HTMLDivElement>, "onPointerMove" | "onPointerLeave" | "onPointerDown" | "onPointerUp" | "onPointerCancel" | "onClick" | "onFocus" | "onBlur" | "onKeyDown">>;

/**
 * The timeline as one element: on the wall clock a slider whose value is the
 * reading (TimelineAccessibility, TimelineReadingValue), so only this reads
 * the moment; on match minutes a picture with its summary.
 */
function Surface({ box, pointer, marks, layout, label, hintID, handlers, children }: { box: React.RefObject<HTMLDivElement | null>; pointer: OddsPointer; marks: readonly TimelineMark[]; layout: OddsLayout | null; label: string; hintID: string; handlers: Handlers; children: ReactNode }) {
  const moment = usePointer(pointer, (p) => (layout ? p.moment : null));
  const style = { height: `calc(${TIMELINE_HEIGHT} * var(--pt))` };
  if (!layout) {
    return (
      <div ref={box} className={styles.surface} style={style} role="img" aria-label={label} {...handlers}>
        {children}
      </div>
    );
  }
  const minutes = (t: number) => Math.round((t - layout.domain.from) / 60_000);
  const readable = layout.readable;
  return (
    <div
      ref={box}
      className={styles.surface}
      style={style}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-describedby={hintID}
      aria-valuemin={0}
      aria-valuemax={minutes(readable.to)}
      aria-valuenow={minutes(moment ?? readable.to)}
      aria-valuetext={readingValue(marks, moment)}
      {...handlers}
    >
      {children}
    </div>
  );
}

/** The reading's line down the track, in the small reader that observes it (TimelineRule). */
function TimelineRule({ layout, pointer }: { layout: OddsLayout; pointer: OddsPointer }) {
  const moment = usePointer(pointer, (p) => p.moment);
  if (moment == null || moment < layout.domain.from || moment > layout.domain.to) return null;
  const x = layout.x(moment);
  if (x < layout.plot.x - 0.5 || x > maxX(layout.plot) + 0.5) return null;
  return <span className={styles.rule} style={{ transform: `translateX(calc(${x} * var(--pt)))`, height: `calc(${TIMELINE_PLOT_HEIGHT - 4} * var(--pt))` }} aria-hidden="true" />;
}

function Mark({ m, x, color, emphasized }: { m: DetailMoment; x: number; color: string; emphasized: boolean }) {
  const y = laneY(m);
  const grow = emphasized ? 1.35 : 1;
  if (round(m)) {
    const r = 4.5 * grow;
    return (
      <g className={emphasized ? styles.emphasized : undefined}>
        <circle cx={x} cy={y} r={r} fill={color} className={styles.goal} />
        {emphasized ? <circle cx={x} cy={y} r={r + 2} fill="none" stroke="var(--label)" strokeWidth={1} /> : null}
      </g>
    );
  }
  if (m.kind === "yellow" || m.kind === "red" || m.kind === "turnover") {
    const w = 5 * grow;
    const h = 7 * grow;
    return (
      <g className={emphasized ? styles.emphasized : undefined}>
        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={1} className={styles.card} data-kind={m.kind} style={m.kind === "turnover" ? { fill: color } : undefined} />
        {emphasized ? <rect x={x - w / 2 - 1.5} y={y - h / 2 - 1.5} width={w + 3} height={h + 3} rx={2} fill="none" stroke="var(--label)" strokeWidth={1} /> : null}
      </g>
    );
  }
  return null;
}
