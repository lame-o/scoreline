/**
 * The pitch (LiveViews.swift `PitchView`, `ShotMoment`, `CardShown`;
 * LiveCelebrations.swift `NetRipple`): live, the ball's latest position
 * with the last 10 actions trailing behind it and a ring in the color of the
 * team that touched it last (events arrive late and in bursts: last touch,
 * not possession); then and after, every shot of the match, goals filled
 * with their path to the line. Home (top) attacks right.
 *
 * Linked: a shot (or, live, a recent action) under the pointer becomes the
 * page's focus, and a focused key event or shot is drawn larger and ringed,
 * with its path, while the rest step back. A card is drawn only when its key
 * event is pointed at.
 *
 * Live, a goal, a shot or a card plays as it happened: the shot's path draws
 * from where it was struck, then a goal lights the mouth and bellies the net
 * (and confetti flies back into the pitch from where it crossed the line), a
 * save or block stops at a tick (a save glints), a shot off the woodwork
 * rattles the post, a miss fades away; a big chance draws at a goal's weight
 * and lingers. A card swings round to face you.
 *
 * Cost: the lines and the marks are two canvases redrawn when the data, the
 * size, the theme or the focus changes; the ball glides on the compositor;
 * the moment is an SVG whose CSS animations end on their own.
 */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { focusRoom, shotSummary, woodwork, type PitchAction } from "../../../data/liveFeeds/soccer";
import { shortened, type LiveMoment } from "../../../data/moments";
import type { Side } from "../../../data/models";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { spokenStatus } from "../../../data/format";
import { plural } from "../../../data/format";
import { useSettings } from "../../../state/settings";
import { useColorScheme } from "../../../state/theme";
import { colorResolver, fitCanvas } from "../core/canvasColors";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell } from "../core/DetailSection";
import { useFocus, useLinkedMarks, type HoverMark } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize, useReducedMotion } from "../core/useMedia";
import styles from "./Pitch.module.css";

/** Fills the width up to this tall, then centers with its footer. */
const MAX_PLOT_HEIGHT = 260;
const ASPECT = 105 / 68;

export interface PitchProps {
  readonly trail: readonly PitchAction[];
  readonly shots: readonly PitchAction[];
  /** Cards at the foul that drew them; drawn only when their key event is pointed at. */
  readonly cards: Readonly<Record<string, PitchAction>>;
  readonly live: boolean;
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  readonly spokenTop: string;
  readonly spokenBottom: string;
  /** The section's width in points (the shots in numbers show from large). */
  readonly width: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const point = (size: Size, x: number, y: number) => ({ x: (size.width * x) / 100, y: (size.height * (100 - y)) / 100 });

export const Pitch = memo(function Pitch({ trail, shots, cards, live, palette, topName, bottomName, spokenTop, spokenBottom, width }: PitchProps) {
  const box = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLCanvasElement>(null);
  const marks = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const scheme = useColorScheme();
  const reduce = useReducedMotion();
  const level = useSettings((s) => s.celebrationLevel);
  const moment = useChartMoment("pitch");

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const color = (side: Side) => (side === "top" ? palette.top : palette.bottom);
  const css = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);
  const ball = live && trail.length > 0 ? trail.at(-1)! : null;
  const ballAt = ball ? point(size, ball.endX ?? ball.x, ball.endY ?? ball.y) : null;
  const momentAction = moment ? ([...trail, ...shots].findLast((a) => a.playID === moment.id) ?? cards[moment.id] ?? null) : null;

  // The focused shot, card or (live) recent action.
  const focusID = useFocus((f) => f?.play ?? null);
  const target = focusID ? ((live ? trail.findLast((a) => a.playID === focusID) : undefined) ?? shots.find((a) => a.playID === focusID) ?? cards[focusID] ?? null) : null;

  // The lines: when the size or theme changes.
  useLayoutEffect(() => {
    const canvas = lines.current;
    if (!canvas || size.width === 0) return;
    const fit = fitCanvas(canvas);
    if (fit) drawMarkings(fit.ctx, fit.width, fit.height, colorResolver(canvas, scheme), pointSize());
  }, [size, scheme]);

  // Every shot (goals with their path), and while live the last few actions; the ball's and the focused mark's room cleared.
  useLayoutEffect(() => {
    const canvas = marks.current;
    if (!canvas || size.width === 0) return;
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const ink = colorResolver(canvas, scheme);
    const pt = pointSize();
    const { ctx } = fit;
    drawMarks(ctx, size, shots, trail, live, (side) => ink(css(color(side))), pt);
    // Rooms: the ball's (live) and the focused mark's. Everything under them stops short.
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const room = (x: number, y: number, r: number) => {
      ctx.beginPath();
      ctx.arc(x, y, r * pt, 0, 2 * Math.PI);
      ctx.fill();
    };
    if (ballAt) room(ballAt.x, ballAt.y, 5.5);
    const r = target ? focusRoom(target) : null;
    if (target && r) {
      const c = point(size, target.x, target.y);
      room(c.x, c.y, r);
    }
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, scheme, shots, trail, live, palette, ballAt?.x, ballAt?.y, target]);

  // Hover targets: every shot; live, the recent actions too. Goals and the live trail answer anywhere along their line.
  const hoverable = useMemo(() => (live ? [...trail, ...shots] : shots), [live, trail, shots]);
  const targets: HoverMark[] = useMemo(
    () =>
      hoverable.map((a) => {
        const lined = a.kind === "goal" || (live && a.kind !== "shot");
        const p = point(size, a.x, a.y);
        if (lined && a.endX != null && a.endY != null) {
          const e = point(size, a.endX, a.endY);
          return { x: p.x, y: p.y, x2: e.x, y2: e.y };
        }
        return p;
      }),
    [hoverable, size, live],
  );
  const hover = useLinkedMarks(targets, (i) => ({ play: hoverable[i]!.playID }));

  // The burst: confetti from where the ball crossed the line, a save's glint at the stop, sparks at the post it rattled.
  const stage = (() => {
    if (!moment || !momentAction || size.width === 0) return null;
    const a = momentAction;
    const end = a.endX != null && a.endY != null ? point(size, a.endX, a.endY) : null;
    switch (moment.kind) {
      case "goal": {
        const right = (end?.x ?? (a.side === "top" ? size.width : 0)) > size.width / 2;
        const mouth = (size.height * 3.66) / 68;
        const y = end ? Math.min(Math.max(end.y, size.height / 2 - mouth), size.height / 2 + mouth) : size.height / 2;
        return { origin: { x: right ? size.width : 0, y }, direction: ((right ? -150 : -30) * Math.PI) / 180, color: color(a.side) };
      }
      case "shotSaved":
        return end ? { origin: end, direction: -Math.PI / 2, color: color(a.side) } : null;
      case "shotWide": {
        const w = moment.accents.has("woodwork") ? woodwork(a) : null;
        return w ? { origin: point(size, w.x, w.y), direction: -Math.PI / 2, color: color(a.side) } : null;
      }
      default:
        return null;
    }
  })();

  const last = trail.at(-1);
  const spoken = (() => {
    if (live && last) return `Live pitch. Latest: ${spokenStatus(last.minute)}, ${last.text}, last touch ${last.side === "top" ? spokenTop : spokenBottom}. ${plural(shots.length, "shot")} so far.`;
    const count = (side: Side) => {
      const mine = shots.filter((s) => s.side === side);
      return `${plural(mine.length, "shot")}, ${plural(mine.filter((s) => s.kind === "goal").length, "goal")}`;
    };
    return `Shot map. ${spokenTop}: ${count("top")}. ${spokenBottom}: ${count("bottom")}.`;
  })();

  return (
    <div className={styles.pitch} style={{ maxWidth: `calc(${MAX_PLOT_HEIGHT * ASPECT + 20} * var(--pt))` }}>
      <VizWell>
        <div ref={box} className={styles.plot} style={{ aspectRatio: "105 / 68" }} role="img" aria-label={spoken} {...hover}>
          <canvas ref={lines} className={styles.layer} />
          <canvas ref={marks} className={styles.layer} data-receded={target != null} />
          {ballAt && last ? (
            <span className={styles.ball} data-reduce={reduce} style={{ transform: `translate(${ballAt.x}px, ${ballAt.y}px)`, color: css(color(last.side)) }} aria-hidden="true" />
          ) : null}
          {moment && momentAction && size.width > 0 ? (
            <Moment key={moment.id} moment={moment} action={momentAction} size={size} color={css(color(momentAction.side))} reduce={reduce} level={level} hidden={target != null} />
          ) : null}
          {target && size.width > 0 ? <Focused action={target} size={size} color={css(color(target.side))} /> : null}
          {stage ? <CelebrationStage key={moment!.id} moment={moment} origin={stage.origin} colors={{ primary: stage.color }} direction={stage.direction} /> : null}
        </div>
      </VizWell>
      <ChartFooter readout={target ? { lead: target.minute, detail: shortened(target.text) } : null} moment={moment}>
        <Legend>
          <LegendItem label={`${topName} →`} swatch={<span className={styles.dot} style={{ background: css(palette.top) }} />} />
          <LegendItem label={`← ${bottomName}`} swatch={<span className={styles.dot} style={{ background: css(palette.bottom) }} />} />
          {live && last ? (
            <span className={styles.latest}>{`${last.minute} ${last.text}`}</span>
          ) : (
            <>
              <LegendItem label="Shot" swatch={<span className={styles.ring} />} />
              <LegendItem
                label="Goal and its path"
                swatch={
                  <span className={styles.goalSwatch}>
                    <span />
                    <span />
                  </span>
                }
              />
            </>
          )}
          {width >= 460 && shots.length > 0 ? <span className={styles.summary}>{shotSummary(shots, topName, bottomName)}</span> : null}
        </Legend>
      </ChartFooter>
    </div>
  );
});

/** Pitch lines to scale (105 × 68 m), in the shared marking ink; the goal mouths a step stronger. */
function drawMarkings(ctx: CanvasRenderingContext2D, width: number, height: number, ink: (css: string) => string, pt: number): void {
  const sx = width / 105;
  const sy = height / 68;
  ctx.strokeStyle = ink("color-mix(in srgb, var(--label) 16%, transparent)");
  ctx.lineWidth = pt;
  ctx.beginPath();
  ctx.rect(0.5, 0.5, width - 1, height - 1);
  ctx.moveTo(52.5 * sx, 0);
  ctx.lineTo(52.5 * sx, height);
  ctx.moveTo((52.5 + 9.15) * sx, 34 * sy);
  ctx.ellipse(52.5 * sx, 34 * sy, 9.15 * sx, 9.15 * sy, 0, 0, 2 * Math.PI);
  // Penalty areas and goal areas.
  ctx.rect(0, (34 - 20.16) * sy, 16.5 * sx, 40.32 * sy);
  ctx.rect((105 - 16.5) * sx, (34 - 20.16) * sy, 16.5 * sx, 40.32 * sy);
  ctx.rect(0, (34 - 9.16) * sy, 5.5 * sx, 18.32 * sy);
  ctx.rect((105 - 5.5) * sx, (34 - 9.16) * sy, 5.5 * sx, 18.32 * sy);
  ctx.stroke();
  ctx.strokeStyle = ink("var(--viz-reference)");
  ctx.lineWidth = 2 * pt;
  ctx.beginPath();
  ctx.moveTo(pt, (34 - 3.66) * sy);
  ctx.lineTo(pt, (34 + 3.66) * sy);
  ctx.moveTo(width - pt, (34 - 3.66) * sy);
  ctx.lineTo(width - pt, (34 + 3.66) * sy);
  ctx.stroke();
  ctx.fillStyle = ink("var(--viz-reference)");
  ctx.beginPath();
  ctx.ellipse(52.5 * sx, 34 * sy, 0.4 * sx, 0.4 * sy, 0, 0, 2 * Math.PI);
  ctx.fill();
}

/**
 * Shots as hollow rings and goals filled, each goal with room cleared around
 * it and its path from where it was struck to the line; live, the shots step
 * back to 0.3 and the last actions trail over them, the oldest faintest.
 */
function drawMarks(ctx: CanvasRenderingContext2D, size: Size, shots: readonly PitchAction[], trail: readonly PitchAction[], live: boolean, colorOf: (side: Side) => string, pt: number): void {
  const at = (a: PitchAction) => point(size, a.x, a.y);
  // Goals' paths first, under the marks.
  for (const s of shots) {
    if (s.kind !== "goal" || s.endX == null || s.endY == null) continue;
    const a = at(s);
    const b = point(size, s.endX, s.endY);
    ctx.save();
    ctx.globalAlpha = live ? 0.3 : 0.75;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = colorOf(s.side);
    ctx.lineWidth = 1.25 * pt;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }
  // Each goal clears room in the marks drawn before it.
  shots.forEach((s, i) => {
    const c = at(s);
    const later = shots.slice(i + 1).filter((x) => x.kind === "goal");
    ctx.save();
    if (later.length > 0) {
      ctx.beginPath();
      ctx.rect(-20, -20, size.width + 40, size.height + 40);
      for (const g of later) {
        const p = at(g);
        ctx.moveTo(p.x + 6.5 * pt, p.y);
        ctx.arc(p.x, p.y, 6.5 * pt, 0, 2 * Math.PI, true);
      }
      ctx.clip("evenodd");
    }
    ctx.globalAlpha = live ? 0.3 : 1;
    ctx.beginPath();
    if (s.kind === "goal") {
      ctx.arc(c.x, c.y, 5 * pt, 0, 2 * Math.PI);
      ctx.fillStyle = colorOf(s.side);
      ctx.fill();
    } else {
      ctx.arc(c.x, c.y, 3.25 * pt, 0, 2 * Math.PI);
      ctx.strokeStyle = colorOf(s.side);
      ctx.lineWidth = 1.5 * pt;
      ctx.stroke();
    }
    ctx.restore();
  });
  if (!live) return;
  // The last actions, oldest faintest.
  trail.forEach((a, index) => {
    const newest = index === trail.length - 1;
    const alpha = 0.15 + (0.85 * (index + 1)) / Math.max(trail.length, 1);
    const start = at(a);
    const next = trail[index + 1];
    const end = a.endX != null && a.endY != null ? point(size, a.endX, a.endY) : next ? at(next) : null;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = colorOf(a.side);
    ctx.fillStyle = colorOf(a.side);
    if (end) {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.lineWidth = (newest ? 2 : 1.5) * pt;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(start.x, start.y, 1.5 * pt, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  });
}

/** The focused shot, larger and ringed, with its path; a recent action ringed; a card as the card itself. */
function Focused({ action, size, color }: { action: PitchAction; size: Size; color: string }) {
  const c = point(size, action.x, action.y);
  const end = action.endX != null && action.endY != null ? point(size, action.endX, action.endY) : null;
  const card = action.kind === "yellow" || action.kind === "red";
  return (
    <svg className={styles.overlay} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
      {end && !card ? (
        <g style={{ color }}>
          <line x1={c.x} y1={c.y} x2={end.x} y2={end.y} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray={action.kind === "pass" ? "4 3" : undefined} />
          <circle cx={end.x} cy={end.y} r={2.5} fill="currentColor" />
        </g>
      ) : null}
      <g className={styles.badge} style={{ transformOrigin: `${c.x}px ${c.y}px` }}>
        {card ? (
          <rect x={c.x - 4} y={c.y - 5.5} width={8} height={11} rx={1.5} className={styles.card} data-red={action.kind === "red"} transform={`rotate(8 ${c.x} ${c.y})`} />
        ) : action.kind === "pass" || action.kind === "other" ? (
          <>
            <circle cx={c.x} cy={c.y} r={3.5} fill={color} />
            <circle cx={c.x} cy={c.y} r={5.5} fill="none" stroke="var(--label)" strokeWidth={1} />
          </>
        ) : (
          <>
            {action.kind === "goal" ? <circle cx={c.x} cy={c.y} r={6} fill={color} /> : <circle cx={c.x} cy={c.y} r={5} fill="none" stroke={color} strokeWidth={2} />}
            <circle cx={c.x} cy={c.y} r={8} fill="none" stroke="var(--label)" strokeWidth={1} />
          </>
        )}
      </g>
    </svg>
  );
}

/**
 * What just happened, drawn as it happened (ShotMoment, CardShown). The path
 * draws from where it was struck (0.35 s); then a goal lights the mouth and
 * the net bellies (NetRipple), a save or block stops at a tick, the woodwork
 * rattles, a miss fades away (a big chance lingers 0.4 s longer). A ring
 * pings where it was struck. Pointing at the chart takes over (it stays
 * mounted, unseen, so it plays once).
 */
function Moment({ moment, action, size, color, reduce, level, hidden }: { moment: LiveMoment; action: PitchAction; size: Size; color: string; reduce: boolean; level: "full" | "subtle" | "off"; hidden: boolean }) {
  const c = point(size, action.x, action.y);
  if (moment.kind === "yellowCard" || moment.kind === "redCard") {
    return (
      <svg className={styles.overlay} viewBox={`0 0 ${size.width} ${size.height}`} data-hidden={hidden} aria-hidden="true">
        <g className={styles.cardShown} data-turns={level !== "off" && !reduce} style={{ transformOrigin: `${c.x}px ${c.y}px` }}>
          <rect x={c.x - 4} y={c.y - 5.5} width={8} height={11} rx={1.5} className={styles.card} data-red={moment.kind === "redCard"} transform={`rotate(8 ${c.x} ${c.y})`} />
        </g>
      </svg>
    );
  }
  const end = action.endX != null && action.endY != null ? point(size, action.endX, action.endY) : null;
  const big = moment.kind === "goal" || moment.accents.has("bigChance");
  const mouth = (size.height * 3.66) / 68;
  const goalSide = end ? end.x > size.width / 2 : action.side === "top";
  const wood = moment.accents.has("woodwork") ? woodwork(action) : null;
  const woodAt = wood ? point(size, wood.x, wood.y) : null;
  const angle = end ? (Math.atan2(end.y - c.y, end.x - c.x) * 180) / Math.PI + 90 : 0;
  return (
    <svg className={styles.overlay} viewBox={`0 0 ${size.width} ${size.height}`} data-hidden={hidden} data-reduce={reduce} data-kind={moment.kind} data-big={big} aria-hidden="true" style={{ color }}>
      {end ? (
        <>
          <path className={styles.shot} d={`M${c.x} ${c.y}L${end.x} ${end.y}`} pathLength={1} strokeWidth={big ? 2 : 1.5} />
          {moment.kind === "goal" ? (
            <>
              <NetRipple x={goalSide ? size.width - 1 : 1} near={size.height / 2 - mouth} far={size.height / 2 + mouth} outward={goalSide ? 1 : -1} level={level} reduce={reduce} />
              <rect className={styles.mouth} x={goalSide ? size.width - 3 : 0} y={size.height / 2 - mouth} width={3} height={mouth * 2} rx={1.5} />
            </>
          ) : moment.kind === "shotSaved" || moment.kind === "shotBlocked" ? (
            <rect className={styles.stop} data-saved={moment.kind === "shotSaved"} x={end.x - 0.75} y={end.y - 4} width={1.5} height={8} rx={0.75} transform={`rotate(${angle} ${end.x} ${end.y})`} style={{ transformOrigin: `${end.x}px ${end.y}px` }} />
          ) : woodAt ? (
            <g className={styles.post} data-vertical={woodAt.y < size.height / 2 ? "up" : "down"} style={{ transformOrigin: `${woodAt.x}px ${woodAt.y}px` }}>
              <rect x={woodAt.x - 1.5} y={woodAt.y - 3.5} width={3} height={7} rx={1.5} fill="currentColor" stroke="var(--label)" strokeOpacity={0.5} strokeWidth={1} />
            </g>
          ) : null}
        </>
      ) : null}
      <circle className={styles.ping} cx={c.x} cy={c.y} r={6} fill="none" strokeWidth={1.5} style={{ transformOrigin: `${c.x}px ${c.y}px` }} />
    </svg>
  );
}

/**
 * The net behind the line bellies out as the ball hits it, then springs back
 * to a sag and fades (NetRipple, 0.8 s from the moment the path lands). A
 * quadratic whose control point sits 2d out peaks d out at its middle, so
 * scaling one drawn at depth 1 across the line is the belly's depth. Subtle:
 * half as deep; Reduce Motion: a still net, in and out; Off: none.
 */
function NetRipple({ x, near, far, outward, level, reduce }: { x: number; near: number; far: number; outward: number; level: "full" | "subtle" | "off"; reduce: boolean }) {
  if (level === "off") return null;
  const depth = level === "subtle" ? 4.5 : 9;
  const mid = (near + far) / 2;
  const control = x + outward * 2;
  const strands = [0.33, 0.67].map((f) => near + (far - near) * f);
  return (
    <g className={styles.net} data-reduce={reduce} style={{ transformOrigin: `${x}px ${mid}px`, "--depth": depth } as React.CSSProperties}>
      <path d={`M${x} ${near}Q${control} ${mid} ${x} ${far}`} fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {strands.map((y) => {
        // The belly's offset at this height, on the depth-1 curve.
        const t = (y - near) / (far - near);
        const bulge = 2 * (1 - t) * t * 2 * outward;
        return <line key={y} x1={x} y1={y} x2={x + bulge} y2={y} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
    </g>
  );
}
