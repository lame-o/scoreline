/**
 * The match on one track (Visualizations.swift `SoccerTimeline`): each
 * team's goals and cards in its own lane (labeled), half-time marked, and,
 * live, time played filled to a red "now" dot. From large up a tick every
 * 15', so minutes read off the axis. Pointing at a mark (or at its key event)
 * picks it out, and the minute row says what it was instead.
 *
 * SVG: thirty-odd marks, redrawn only when the data or the focus changes;
 * the now dot and the played fill glide (Motion.standard) as the minute turns.
 */
import { memo, useLayoutEffect, useRef, useState } from "react";
import type { DetailMoment } from "../../../data/gameDetail";
import { plural } from "../../../data/format";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { headline } from "../core/CommonSections";
import { useFocus, useLinkedMarks } from "../core/linked";
import { pointSize, useReducedMotion } from "../core/useMedia";
import styles from "./Timeline.module.css";

const GUTTER = 30;
const HEIGHT = 60;
const laneY = (m: DetailMoment) => (m.side === "bottom" ? 38 : 10);

export interface TimelineProps {
  readonly moments: readonly DetailMoment[];
  /** Live: the match minute (the now dot and the played fill). */
  readonly currentMinute: number | null;
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  /** The section's width in points: quarter-hour ticks from large. */
  readonly width: number;
}

export const Timeline = memo(function Timeline({ moments, currentMinute, palette, topName, bottomName, width }: TimelineProps) {
  const box = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setPlotWidth(el.clientWidth / pointSize());
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const marked = moments.filter((m) => m.minute != null && m.kind !== "other" && m.kind !== "score");
  const length = Math.max(90, Math.ceil(Math.max(0, ...marked.map((m) => m.minute ?? 0))), currentMinute ?? 0);
  // A little room at the end, so the last mark's ring isn't clipped.
  const w = Math.max(plotWidth - GUTTER - 6, 0);
  const x = (m: number) => GUTTER + w * Math.min(m / length, 1);
  const ticks = width >= 460 ? Array.from({ length: Math.floor(length / 15) }, (_, i) => (i + 1) * 15).filter((m) => m !== 45 && m < length) : [];
  // A tick near the end (90' in stoppage time) keeps its line, not its label.
  const labeled = ticks.filter((m) => x(length) - 8 - x(m) >= 22);
  const pt = pointSize();
  const marks = marked.map((m) => ({ x: x(m.minute!) * pt, y: laneY(m) * pt }));
  const hover = useLinkedMarks(marks, (i) => ({ play: marked[i]!.id }));
  const focusID = useFocus((f) => f?.play ?? null);
  const target = focusID ? (marked.find((m) => m.id === focusID) ?? null) : null;
  const color = (m: DetailMoment) => {
    const c = m.side === "bottom" ? palette.bottom : palette.top;
    return c === NEUTRAL ? "var(--viz-neutral)" : c;
  };
  const goals = moments.filter((m) => m.kind === "goal" || m.kind === "ownGoal").length;
  const yellows = moments.filter((m) => m.kind === "yellow").length;
  const reds = moments.filter((m) => m.kind === "red").length;
  const spoken = `Timeline${currentMinute != null ? ` to ${Math.floor(currentMinute)} minutes` : ""}: ${plural(goals, "goal")}, ${plural(yellows, "yellow card")}, ${plural(reds, "red card")}.`;

  return (
    <div ref={box} className={styles.timeline} style={{ height: `calc(${HEIGHT} * var(--pt))` }} role="img" aria-label={spoken} {...hover}>
      {w > 0 ? (
        <svg className={styles.svg} viewBox={`0 0 ${plotWidth} ${HEIGHT}`} data-reduce={reduce} aria-hidden="true">
          <text className={styles.team} x={GUTTER / 2 - 2} y={10}>
            {topName}
          </text>
          <text className={styles.team} x={GUTTER / 2 - 2} y={38}>
            {bottomName}
          </text>
          <rect className={styles.track} x={GUTTER} y={23} width={w} height={2} rx={1} />
          {length > 90 ? <rect className={styles.extra} x={x(90)} y={23} width={x(length) - x(90)} height={2} /> : null}
          {ticks.map((m) => (
            <rect key={m} className={styles.tick} x={x(m) - 0.5} y={22} width={1} height={4} />
          ))}
          {currentMinute != null ? <rect className={styles.played} x={GUTTER} y={23} width={w} height={2} style={{ transform: `scaleX(${(x(currentMinute) - GUTTER) / Math.max(w, 1)})`, transformOrigin: `${GUTTER}px 24px` }} /> : null}
          <line className={styles.half} x1={x(45)} y1={19} x2={x(45)} y2={29} />
          {currentMinute != null ? <circle className={styles.ring} cx={0} cy={24} r={4.5} style={{ transform: `translateX(${x(currentMinute)}px)` }} /> : null}
          <g className={styles.marks} data-receded={target != null}>
            {/* Cards first; each goal clears room around it (a page-colored edge). */}
            {[...marked].sort((a, b) => Number(a.kind === "goal" || a.kind === "ownGoal") - Number(b.kind === "goal" || b.kind === "ownGoal")).map((m) => (
              <Mark key={m.id} m={m} x={x(m.minute!)} color={color(m)} emphasized={false} />
            ))}
          </g>
          {currentMinute != null ? <circle className={styles.now} cx={0} cy={24} r={3} style={{ transform: `translateX(${x(currentMinute)}px)` }} /> : null}
          {target ? <Mark m={target} x={x(target.minute!)} color={color(target)} emphasized /> : null}
          <g className={styles.labels} data-hidden={target != null}>
            <text className={styles.landmark} x={GUTTER + 6} y={54} textAnchor="middle">
              0'
            </text>
            <text className={styles.landmark} x={x(45)} y={54} textAnchor="middle">
              HT
            </text>
            <text className={styles.landmark} x={x(length) - 8} y={54} textAnchor="middle">
              {`${Math.round(length)}'`}
            </text>
            {labeled.map((m) => (
              <text key={m} className={styles.quarter} x={x(m)} y={54} textAnchor="middle">
                {`${m}'`}
              </text>
            ))}
          </g>
        </svg>
      ) : null}
      {target ? (
        <p className={styles.readout} style={{ left: `calc(${GUTTER} * var(--pt))` }}>
          <strong>{target.clock}</strong>
          {`  ${headline(target)}`}
        </p>
      ) : null}
    </div>
  );
});

function Mark({ m, x, color, emphasized }: { m: DetailMoment; x: number; color: string; emphasized: boolean }) {
  const y = laneY(m);
  const grow = emphasized ? 1.35 : 1;
  if (m.kind === "goal" || m.kind === "ownGoal" || m.kind === "score") {
    const r = 4.5 * grow;
    return (
      <g className={emphasized ? styles.emphasized : undefined}>
        <circle cx={x} cy={y} r={r} fill={color} className={styles.goal} />
        {emphasized ? <circle cx={x} cy={y} r={r + 2} fill="none" stroke="var(--label)" strokeWidth={1} /> : null}
      </g>
    );
  }
  if (m.kind === "yellow" || m.kind === "red") {
    const w = 5 * grow;
    const h = 7 * grow;
    return (
      <g className={emphasized ? styles.emphasized : undefined}>
        <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={1} className={styles.card} data-red={m.kind === "red"} />
        {emphasized ? <rect x={x - w / 2 - 1.5} y={y - h / 2 - 1.5} width={w + 3} height={h + 3} rx={2} fill="none" stroke="var(--label)" strokeWidth={1} /> : null}
      </g>
    );
  }
  return null;
}
