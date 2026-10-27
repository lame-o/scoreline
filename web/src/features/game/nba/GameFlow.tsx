/**
 * Game flow (BasketballViews.swift `GameFlowView`): the score margin through
 * the game as a step line, above the middle while the top team leads, below
 * while the bottom team does, each side filled faintly in its team's color.
 * Quarters are marked; pointing reads out the score at that moment and
 * lights the basket on the court; a click holds the court's replay there.
 * Live, ESPN's scoring run shows as a band in the running team's color with
 * its name at the end, the line ends at a red "now" dot, a late lead change
 * sparks where it crossed, and a period's end pings.
 *
 * The line is one canvas, redrawn when the data, size or theme changes, and
 * on each frame of a running replay (from the stage, with no React render);
 * hovers move only small DOM layers.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  flowExtent,
  flowReadout,
  flowStory,
  margin,
  periodLabels,
  periodStart,
  periodsPlayed,
  spanLabel,
  type FlowPoint,
} from "../../../data/basketball";
import { sparks } from "../../../data/celebrations";
import type { Side } from "../../../data/models";
import { runLabel, runSpan, type Run } from "../../../data/liveFeeds/basketball";
import { Tier } from "../../../data/moments";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { useSettings } from "../../../state/settings";
import { useColorScheme } from "../../../state/theme";
import { colorResolver, fitCanvas } from "../core/canvasColors";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell, type Readout } from "../core/DetailSection";
import { sameFocus, useFocus, useLinkedStore, type Focus } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize } from "../core/useMedia";
import { useStage, useStageStore } from "./stage";
import styles from "./GameFlow.module.css";

const GUTTER = 30;
const TRAILING = 18;
const PAD = 8;

export interface GameFlowProps {
  readonly flow: readonly FlowPoint[];
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  readonly spokenTop: string;
  readonly spokenBottom: string;
  /** Game seconds played, while live: the line runs to here. */
  readonly now: number | null;
  readonly final: boolean;
  readonly quarter: number;
  /** ESPN's run while it's on (live). */
  readonly runs: readonly Run[];
  /** The section's width in points: the plot steps to 128pt tall, and the summary shows, from large. */
  readonly width: number;
}

const measure = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (text: string) => {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return text.length * 6;
    ctx.font = `500 ${9 * pointSize()}px system-ui, -apple-system, sans-serif`;
    return ctx.measureText(text).width / pointSize();
  };
})();

export const GameFlow = memo(function GameFlow({ flow, palette, topName, bottomName, spokenTop, spokenBottom, now, final, quarter, runs, width }: GameFlowProps) {
  const stage = useStageStore();
  const paused = useStage(stage, (s) => s.paused);
  const playback = useStage(stage, (s) => s.playback);
  const level = useSettings((s) => s.celebrationLevel);
  const scheme = useColorScheme();
  const linked = useLinkedStore();
  const moment = useChartMoment("court");
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [plotWidth, setPlotWidth] = useState(0);
  const hovered = useRef<Focus | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setPlotWidth(el.clientWidth / pointSize());
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const height = width >= 460 ? 128 : 96;
  const periods = periodsPlayed(Math.max(1, ...flow.map((p) => p.period)), now, quarter);
  const length = periodStart(periods + 1, quarter);
  const lineEnd = final ? length : Math.min(Math.max(now ?? 0, flow.at(-1)?.elapsed ?? 0), length);
  const extent = flowExtent(flow);
  const w = Math.max(plotWidth - GUTTER - TRAILING, 0);
  const x = useCallback((t: number) => GUTTER + w * Math.min(Math.max(t / length, 0), 1), [w, length]);
  const mid = height / 2;
  const reach = mid - 4;
  const y = useCallback((m: number) => mid - (m / (extent * 1.06)) * reach, [mid, reach, extent]);
  const replay = paused != null ? Math.min(paused, lineEnd) : playback ? Math.min(stage?.time() ?? playback.from, lineEnd) : null;
  // ESPN's run while it's on (live, not in a replay).
  const run = replay == null && !final && now != null ? (runs[0] ?? null) : null;
  const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);

  const draw = useCallback(
    (replayAt: number | null) => {
      const el = canvas.current;
      if (!el || w <= 0) return;
      const fit = fitCanvas(el);
      if (!fit) return;
      const { ctx } = fit;
      const pt = pointSize();
      ctx.scale(pt, pt);
      const ink = colorResolver(el, scheme);
      const team = (c: string) => ink(css(c));
      const size = { width: fit.width / pt, height: fit.height / pt };
      // Quarter dividers, and the span each way, faintly.
      ctx.strokeStyle = ink("var(--viz-grid)");
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let p = 2; p <= periods; p++) {
        ctx.moveTo(x(periodStart(p, quarter)), 0);
        ctx.lineTo(x(periodStart(p, quarter)), height);
      }
      ctx.stroke();
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      for (const m of [extent, -extent]) {
        ctx.moveTo(GUTTER, y(m));
        ctx.lineTo(size.width - TRAILING, y(m));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      const zero = y(0);
      const path = (end: number) => {
        const line = new Path2D();
        const area = new Path2D();
        line.moveTo(x(0), zero);
        area.moveTo(x(0), zero);
        let last = 0;
        for (const point of flow.slice(1)) {
          if (point.elapsed > end) break;
          for (const p of [line, area]) {
            p.lineTo(x(point.elapsed), y(last));
            p.lineTo(x(point.elapsed), y(margin(point)));
          }
          last = margin(point);
        }
        line.lineTo(x(end), y(last));
        area.lineTo(x(end), y(last));
        area.lineTo(x(end), zero);
        area.closePath();
        return { line, area, last };
      };
      const solid = (end: number) => {
        const { line, area } = path(end);
        for (const [side, top, h] of [
          ["top", 0, zero],
          ["bottom", zero, size.height - zero],
        ] as const) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, top, size.width, h);
          ctx.clip();
          const color = team(side === "top" ? palette.top : palette.bottom);
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = color;
          ctx.fill(area);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.25;
          ctx.lineJoin = "round";
          ctx.stroke(line);
          ctx.restore();
        }
        ctx.strokeStyle = ink("color-mix(in srgb, var(--label) 18%, transparent)");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(GUTTER, zero);
        ctx.lineTo(size.width - TRAILING, zero);
        ctx.stroke();
      };
      if (replayAt != null) {
        // The rest of the game, faintly, so the replay has its place.
        ctx.strokeStyle = ink("color-mix(in srgb, var(--label) 14%, transparent)");
        ctx.lineWidth = 1;
        ctx.stroke(path(lineEnd).line);
        solid(replayAt);
        const at = flow.findLast((p) => p.elapsed <= replayAt);
        ctx.strokeStyle = ink("var(--viz-reference)");
        ctx.beginPath();
        ctx.moveTo(x(replayAt), 0);
        ctx.lineTo(x(replayAt), height);
        ctx.stroke();
        ctx.fillStyle = ink("var(--label)");
        ctx.beginPath();
        ctx.arc(x(replayAt), y(at ? margin(at) : 0), 3, 0, 2 * Math.PI);
        ctx.fill();
      } else solid(lineEnd);
      const last = flow.at(-1);
      if (!final && now != null && last) {
        ctx.fillStyle = ink("var(--live)");
        ctx.beginPath();
        ctx.arc(x(Math.min(now, length)), y(margin(last)), replayAt == null ? 3 : 2.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [w, flow, periods, quarter, x, y, extent, height, palette, scheme, lineEnd, final, now, length],
  );
  useLayoutEffect(() => draw(replay), [draw, replay]);
  useEffect(() => stage?.onFrame((t) => draw(Math.min(t, lineEnd))), [stage, draw, lineEnd]);

  // The pointed-at point (or quarter, or run), read by small layers.
  const focus = useFocus((f) => f);
  const target = focus?.play ? (flow.find((p) => p.id === focus.play && p.id !== "tip") ?? null) : null;

  const hover = (e: PointerEvent<HTMLDivElement>) => {
    if (!linked || e.pointerType !== "mouse" || w <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (((e.clientX - rect.left) / pointSize() - GUTTER) / w) * length;
    let next: Focus | null = null;
    if (run && t >= run.start && t <= lineEnd + 30) next = { side: run.team, span: runSpan(run) };
    else if (t >= 0 && t <= lineEnd + 30) {
      const index = flow.findLastIndex((p) => p.elapsed <= t);
      if (index > 0) {
        const p = flow[index]!;
        next = { play: p.id, period: p.period, side: p.scorer };
      }
    }
    if (sameFocus(next, hovered.current)) return;
    if (hovered.current) linked.hover(hovered.current, false);
    if (next) linked.hover(next, true);
    hovered.current = next;
  };
  const leave = () => {
    if (hovered.current) linked?.hover(hovered.current, false);
    hovered.current = null;
  };
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    if (!stage || w <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (((e.clientX - rect.left) / pointSize() - GUTTER) / w) * length;
    if (t >= 0) stage.seek(Math.min(t, lineEnd), lineEnd);
  };

  // A late lead change sparks at the zero crossing in the new leader's color; a run's milestone at the band's edge.
  const beat = useMemo(() => {
    if (!moment || replay != null) return null;
    const index = flow.findIndex((p) => p.id === moment.id);
    if (index > 0 && margin(flow[index]!) !== 0 && (moment.kind === "leadChange" || (moment.tier === Tier.score && flow[index]!.period >= 4))) {
      const before = flow.slice(0, index).findLast((p) => margin(p) !== 0);
      if (before && Math.sign(margin(before)) !== Math.sign(margin(flow[index]!))) {
        const p = flow[index]!;
        return { origin: { x: x(p.elapsed), y: y(0) }, color: margin(p) > 0 ? palette.top : palette.bottom };
      }
    }
    const last = flow.at(-1);
    if (moment.kind === "run" && last) return { origin: { x: x(lineEnd), y: y(margin(last)) }, color: moment.side === "bottom" ? palette.bottom : palette.top };
    return null;
  }, [moment, replay, flow, x, y, lineEnd, palette]);
  const pings = replay == null && moment && flow.length > 0 && (moment.kind === "periodEnd" || (level === "off" && (moment.kind === "run" || moment.kind === "leadChange")));

  const story = flowStory(flow);
  const leading = story.top >= story.bottom ? `${topName} +${story.top}` : `${bottomName} +${story.bottom}`;
  const summary = `Lead changes ${story.changes} · Ties ${story.ties} · Largest lead ${leading}`;
  const ticker = `Lead changes ${story.changes} · Ties ${story.ties}`;
  const readout: Readout | null = (() => {
    if (focus && focus.play == null && focus.span) {
      const r = runs.find((x) => runSpan(x)[0] === focus.span![0] && runSpan(x)[1] === focus.span![1]);
      const team = (r?.team ?? focus.side) === "top" ? topName : (r?.team ?? focus.side) === "bottom" ? bottomName : null;
      return { lead: [team, r ? runLabel(r) : "Run"].filter(Boolean).join(" "), detail: spanLabel(focus.span, quarter) };
    }
    return target ? flowReadout(target, topName, bottomName) : null;
  })();
  const labels = w > 0 ? periodLabels(periods, x, measure, quarter) : [];
  const band = (side: Side | null) => css(side === "bottom" ? palette.bottom : palette.top);
  const lastMargin = flow.at(-1) ? margin(flow.at(-1)!) : 0;
  const spokenLead = `Game flow. Largest lead: ${spokenTop} ${story.top}, ${spokenBottom} ${story.bottom}. ${story.changes} lead ${story.changes === 1 ? "change" : "changes"}.`;

  return (
    <div className={styles.flow}>
      <VizWell padding={PAD}>
        <div
          ref={box}
          className={styles.plot}
          style={{ height: `calc(${height + 16} * var(--pt))`, "--plot": `calc(${height} * var(--pt))` } as React.CSSProperties}
          role="img"
          aria-label={spokenLead}
          onPointerMove={hover}
          onPointerLeave={leave}
          onClick={seek}
        >
          {run ? <span className={styles.band} style={{ left: `calc(${x(run.start)} * var(--pt))`, width: `calc(${Math.max(x(lineEnd) - x(run.start), 1)} * var(--pt))`, background: `color-mix(in srgb, ${band(run.team)} 10%, transparent)` }} /> : null}
          {!target && focus?.period != null && !focus.span ? (
            <span className={styles.shade} style={{ left: `calc(${x(periodStart(focus.period, quarter))} * var(--pt))`, width: `calc(${x(periodStart(focus.period + 1, quarter)) - x(periodStart(focus.period, quarter))} * var(--pt))` }} />
          ) : null}
          {!target && focus?.span ? <span className={styles.shade} style={{ left: `calc(${x(focus.span[0])} * var(--pt))`, width: `calc(${Math.max(x(run ? lineEnd : focus.span[1]) - x(focus.span[0]), 1)} * var(--pt))` }} /> : null}
          <canvas ref={canvas} className={styles.canvas} />
          <span className={styles.team} style={{ top: `calc(${mid / 2} * var(--pt))` }}>
            {topName}
          </span>
          <span className={styles.team} style={{ top: `calc(${mid + mid / 2} * var(--pt))` }}>
            {bottomName}
          </span>
          {[extent, -extent].map((m) => (
            <span key={m} className={styles.extent} style={{ top: `calc(${y(m)} * var(--pt))` }}>
              {extent}
            </span>
          ))}
          {target ? <span className={styles.rule} style={{ transform: `translateX(calc(${x(target.elapsed)} * var(--pt)))` }} /> : null}
          {target ? <span className={styles.target} style={{ transform: `translate(calc(${x(target.elapsed)} * var(--pt)), calc(${y(margin(target))} * var(--pt)))` }} /> : null}
          {run ? (
            <span className={styles.runLabel} style={{ right: `calc(${plotWidth - x(lineEnd) + 3} * var(--pt))`, top: `calc(${lastMargin > 0 ? y(-extent) - 14 : y(extent) + 2} * var(--pt))` }}>
              {runLabel(run)}
            </span>
          ) : null}
          {pings && moment ? (
            <span
              key={moment.id}
              className={styles.ping}
              style={{ transform: `translate(calc(${x(lineEnd)} * var(--pt)), calc(${y(lastMargin)} * var(--pt)))`, color: moment.side ? band(moment.side) : "var(--label)" }}
            />
          ) : null}
          {labels.map((l) => (
            <span key={l.text} className={styles.period} style={{ left: `calc(${l.x} * var(--pt))` }}>
              {l.text}
            </span>
          ))}
          {beat && moment ? (
            <CelebrationStage key={`${moment.id}-flow`} moment={moment} origin={{ x: beat.origin.x * pointSize(), y: beat.origin.y * pointSize() }} colors={{ primary: beat.color }} inset={PAD} effects={[sparks(4, 9)]} />
          ) : null}
        </div>
      </VizWell>
      <ChartFooter readout={readout}>
        <Legend>
          <LegendItem label={`${topName} leads`} swatch={<span className={styles.swatch} data-edge="top" style={{ "--c": css(palette.top) } as React.CSSProperties} />} />
          <LegendItem label={`${bottomName} leads`} swatch={<span className={styles.swatch} data-edge="bottom" style={{ "--c": css(palette.bottom) } as React.CSSProperties} />} />
          {!final && now != null ? <LegendItem label="Now" swatch={<span className={styles.nowDot} />} /> : null}
          {width >= 460 && flow.length > 1 ? <span className={styles.summary}>{summary}</span> : !final && now != null && flow.length > 1 ? <span className={styles.summary}>{ticker}</span> : null}
        </Legend>
      </ChartFooter>
    </div>
  );
});
