/**
 * Balls in Play (LiveViews.swift `SprayChartView`): every batted ball on the
 * field, colored by the batting team. Hits are filled, outs are rings, a
 * home run is a ringed dot; each hit clears room in the balls drawn before
 * it, so two close balls stay two balls.
 *
 * Linked: a ball under the pointer becomes the page's focus (its scoring play
 * and inning light up elsewhere); a focus that names balls (a scoring play,
 * an inning's cell) rings them here while the rest step back. Only the small
 * layers that change with the focus redraw: the field and its balls redraw
 * when the data does.
 *
 * Live: the ball just put in play flies in from the plate (home runs arc
 * over the fence, which lights where it went out) and pings where it lands.
 * A home run's fireworks burst here only when the play theater isn't on the
 * page (it owns them, at the wall).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { plural } from "../../../data/format";
import type { BattedBall } from "../../../data/gameDetail";
import type { Side } from "../../../data/models";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { useColorScheme } from "../../../state/theme";
import { colorResolver, fitCanvas } from "../core/canvasColors";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell } from "../core/DetailSection";
import { matches, useFocus, useLinkedMarks } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { useReducedMotion } from "../core/useMedia";
import styles from "./SprayChart.module.css";

// ESPN hit coordinates: home plate ≈ (125, 205); fence ≈ 165 units out.
const HOME = { x: 125, y: 205 };
const FENCE = 165;
const DOMAIN = { x: 0, y: 10, width: 250, height: 210 };
/** Fills the width up to this tall, then centers with its footer. */
const MAX_PLOT_HEIGHT = 300;

export interface SprayChartProps {
  readonly balls: readonly BattedBall[];
  readonly palette: TeamPalette;
  readonly topName: string;
  readonly bottomName: string;
  readonly spokenTop: string;
  readonly spokenBottom: string;
  /** A home run's fireworks: off when the play theater on the page owns them. */
  readonly celebrates: boolean;
  /** The section's width in points (the summary shows from large). */
  readonly width: number;
}

interface Geometry {
  scale: number;
  width: number;
  height: number;
  map: (x: number, y: number) => { x: number; y: number };
}

function geometry(width: number, height: number): Geometry {
  const scale = Math.min(width / DOMAIN.width, height / DOMAIN.height);
  const inset = 5;
  return {
    scale,
    width,
    height,
    map: (x, y) => ({
      x: Math.min(Math.max((x - DOMAIN.x) * scale, inset), width - inset),
      y: Math.min(Math.max((y - DOMAIN.y) * scale, inset), height - inset),
    }),
  };
}

export function SprayChart({ balls, palette, topName, bottomName, spokenTop, spokenBottom, celebrates, width }: SprayChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const lit = useRef<HTMLCanvasElement>(null);
  const scheme = useColorScheme();
  const reduce = useReducedMotion();
  const moment = useChartMoment("plate");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const g = useMemo(() => geometry(size.width, size.height), [size]);
  const colorOf = (side: Side | null) => (side === "bottom" ? palette.bottom : palette.top);
  const flying = moment ? (balls.find((b) => b.id === moment.id) ?? null) : null;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The field and its balls: redrawn when the data, the size or the theme changes.
  useEffect(() => {
    const canvas = base.current;
    if (!canvas || g.width === 0) return;
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx } = fit;
    const ink = colorResolver(canvas, scheme);
    drawField(ctx, g, ink);
    const shown = balls.filter((b) => b.id !== flying?.id);
    drawBalls(ctx, shown, g, ink, colorOf, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balls, g, scheme, palette, flying?.id]);

  // Balls picked out by the focus: drawn emphasized on their own layer; the field layer steps back.
  const focusKey = useFocus((f) => (f ? `${f.play ?? ""}|${f.period ?? ""}|${f.side ?? ""}` : null));
  const focus = useFocus((f) => f);
  const picked = useMemo(() => (focus ? balls.filter((b) => matches(focus, { play: b.id, period: b.period, side: b.side })) : []), [focusKey, balls]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const canvas = lit.current;
    if (!canvas || g.width === 0) return;
    const fit = fitCanvas(canvas);
    if (!fit) return;
    drawBalls(fit.ctx, picked, g, colorResolver(canvas, scheme), colorOf, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, g, scheme, palette]);

  const marks = useMemo(() => balls.map((b) => g.map(b.x, b.y)), [balls, g]);
  const hover = useLinkedMarks(marks, (i) => ({ play: balls[i]!.id, period: balls[i]!.period ?? undefined, side: balls[i]!.side }));
  const pointedBall = focus?.play ? (balls.find((b) => b.id === focus.play) ?? null) : null;
  const homer = flying && celebrates && flying.outcome === "homeRun" && moment?.kind === "homeRun" ? flying : null;

  return (
    <div className={styles.spray} style={{ maxWidth: `calc(${(MAX_PLOT_HEIGHT * DOMAIN.width) / DOMAIN.height + 20} * var(--pt))` }} role="img" aria-label={spoken(balls, spokenTop, spokenBottom)}>
      <VizWell>
        <div ref={box} className={styles.plot} style={{ aspectRatio: `${DOMAIN.width} / ${DOMAIN.height}` }} {...hover} aria-hidden="true">
          <canvas ref={base} className={styles.layer} data-receded={picked.length > 0} />
          <canvas ref={lit} className={styles.layer} />
          {flying && g.width > 0 ? <Flight key={flying.id} ball={flying} g={g} color={colorOf(flying.side)} reduce={reduce} receded={focus != null} /> : null}
          {homer ? (
            <CelebrationStage moment={moment} origin={g.map(homer.x, homer.y)} colors={{ primary: colorOf(homer.side) }} delay={0.3} />
          ) : null}
        </div>
      </VizWell>
      <ChartFooter
        readout={
          pointedBall
            ? { lead: pointedBall.text, detail: [pointedBall.period != null ? `${ordinalInning(pointedBall.period)}` : null, pointedBall.side === "top" ? topName : pointedBall.side === "bottom" ? bottomName : null].filter(Boolean).join(" · ") }
            : null
        }
      >
        <Legend>
          <LegendItem label={topName} swatch={<span className={styles.swatch} style={{ background: swatch(palette.top) }} />} />
          <LegendItem label={bottomName} swatch={<span className={styles.swatch} style={{ background: swatch(palette.bottom) }} />} />
          <LegendItem label="Hit" swatch={<span className={styles.hit} />} />
          <LegendItem label="Out" swatch={<span className={styles.out} />} />
          <LegendItem label="Home run" swatch={<span className={styles.homer} />} />
          {width >= 460 && balls.length > 0 ? <span className={styles.summary}>{summary(balls, topName, bottomName)}</span> : null}
        </Legend>
      </ChartFooter>
    </div>
  );
}

const swatch = (c: string) => (c === NEUTRAL ? "var(--viz-neutral)" : c);
const ordinalInning = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]} inning`;

/** "TB 7 hits, 1 HR · MIL 9 hits" (hits include home runs). */
export function summary(balls: readonly BattedBall[], topName: string, bottomName: string): string {
  const line = (side: Side, name: string) => {
    const mine = balls.filter((b) => (b.side ?? "top") === side);
    const hits = mine.filter((b) => b.outcome !== "out").length;
    const homers = mine.filter((b) => b.outcome === "homeRun").length;
    return `${name} ${hits} ${hits === 1 ? "hit" : "hits"}` + (homers > 0 ? `, ${homers} HR` : "");
  };
  return `${line("top", topName)} · ${line("bottom", bottomName)}`;
}

function spoken(balls: readonly BattedBall[], top: string, bottom: string): string {
  const count = (side: Side) => {
    const mine = balls.filter((b) => (b.side ?? "top") === side);
    return `${plural(mine.filter((b) => b.outcome !== "out").length, "hit")}, ${plural(mine.filter((b) => b.outcome === "out").length, "out")}`;
  };
  const hr = balls.filter((b) => b.outcome === "homeRun").length;
  return `Balls in play. ${top}: ${count("top")}. ${bottom}: ${count("bottom")}. ${plural(hr, "home run")}.`;
}

function drawField(ctx: CanvasRenderingContext2D, g: Geometry, ink: (css: string) => string): void {
  const h = g.map(HOME.x, HOME.y);
  const r = FENCE * g.scale;
  const deg = Math.PI / 180;
  ctx.beginPath();
  ctx.moveTo(h.x, h.y);
  ctx.arc(h.x, h.y, r, -135 * deg, -45 * deg);
  ctx.closePath();
  ctx.fillStyle = ink("color-mix(in srgb, var(--label) 3.5%, transparent)");
  ctx.fill();
  ctx.strokeStyle = ink("color-mix(in srgb, var(--label) 16%, transparent)");
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(h.x, h.y, 62 * g.scale, -135 * deg, -45 * deg);
  ctx.strokeStyle = ink("color-mix(in srgb, var(--label) 12%, transparent)");
  ctx.lineWidth = 0.5;
  ctx.stroke();
  const b = 37 * g.scale * 0.7071;
  const bases = [
    { x: h.x + b, y: h.y - b },
    { x: h.x, y: h.y - 2 * b },
    { x: h.x - b, y: h.y - b },
  ];
  ctx.beginPath();
  ctx.moveTo(h.x, h.y);
  for (const p of bases) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.strokeStyle = ink("color-mix(in srgb, var(--label) 28%, transparent)");
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = ink("color-mix(in srgb, var(--label) 40%, transparent)");
  for (const p of bases) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-2, -2, 4, 4);
    ctx.restore();
  }
}

/** The room a hit keeps clear around it, 1.5pt beyond its edge (an out is a ring and needs none). */
function room(ball: BattedBall): number {
  return ball.outcome === "out" ? 0 : ball.outcome === "homeRun" ? 6.5 : 5.5;
}

function drawBalls(ctx: CanvasRenderingContext2D, balls: readonly BattedBall[], g: Geometry, ink: (css: string) => string, colorOf: (side: Side | null) => string, emphasized: boolean): void {
  const at = balls.map((b) => g.map(b.x, b.y));
  balls.forEach((ball, i) => {
    // Each hit clears room in the balls before it: clip out the rooms of the marks drawn after this one.
    const later = balls.slice(i + 1).flatMap((b, j) => (room(b) > 0 ? [{ c: at[i + 1 + j]!, r: room(b) }] : []));
    ctx.save();
    if (later.length > 0 && !emphasized) {
      ctx.beginPath();
      ctx.rect(-50, -50, g.width + 100, g.height + 100);
      for (const { c, r } of later) {
        ctx.moveTo(c.x + r, c.y);
        ctx.arc(c.x, c.y, r, 0, 2 * Math.PI, true);
      }
      ctx.clip("evenodd");
    }
    drawBall(ctx, ball, at[i]!, ink, colorOf(ball.side), emphasized);
    ctx.restore();
  });
}

function drawBall(ctx: CanvasRenderingContext2D, ball: BattedBall, c: { x: number; y: number }, ink: (css: string) => string, color: string, emphasized: boolean): void {
  const fill = ink(color);
  const grow = emphasized ? 1.4 : 1;
  ctx.beginPath();
  switch (ball.outcome) {
    case "out":
      ctx.arc(c.x, c.y, 3.25 * grow, 0, 2 * Math.PI);
      ctx.strokeStyle = fill;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      break;
    case "homeRun":
      ctx.arc(c.x, c.y, 5 * grow, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5 * grow + 1.5, 0, 2 * Math.PI);
      ctx.strokeStyle = ink("var(--label)");
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    default:
      ctx.arc(c.x, c.y, 4 * grow, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();
  }
  if (emphasized && ball.outcome !== "homeRun") {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 6.5 * grow, 0, 2 * Math.PI);
    ctx.strokeStyle = ink("var(--label)");
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * The ball just put in play (SprayFlight): its path draws from the plate
 * (0.4 s, home runs arcing), the fence lights where it went out, then the
 * mark lands with a ping (from 0.3 s). Reduce Motion: it's simply there.
 */
function Flight({ ball, g, color, reduce, receded }: { ball: BattedBall; g: Geometry; color: string; reduce: boolean; receded: boolean }) {
  const home = g.map(HOME.x, HOME.y);
  const land = g.map(ball.x, ball.y);
  const fence = FENCE * g.scale;
  let d = `M${home.x} ${home.y}L${land.x} ${land.y}`;
  if (ball.outcome === "homeRun") {
    // Home runs arc (the control point lifts toward the top by 0.18 × length).
    const mid = { x: (home.x + land.x) / 2, y: (home.y + land.y) / 2 };
    const length = Math.hypot(land.x - home.x, land.y - home.y);
    let n = { x: land.y - home.y, y: home.x - land.x };
    if (n.y > 0) n = { x: -n.x, y: -n.y };
    const s = length === 0 ? 0 : (0.18 * length) / Math.hypot(n.x, n.y);
    d = `M${home.x} ${home.y}Q${mid.x + n.x * s} ${mid.y + n.y * s} ${land.x} ${land.y}`;
  }
  const bearing = Math.atan2(land.y - home.y, land.x - home.x);
  const arc = (a: number) => ({ x: home.x + fence * Math.cos(a), y: home.y + fence * Math.sin(a) });
  const a0 = arc(bearing - Math.PI / 18);
  const a1 = arc(bearing + Math.PI / 18);
  const c = swatch(color);
  return (
    <svg className={styles.flight} data-reduce={reduce} data-receded={receded} data-out={ball.outcome === "out"} viewBox={`0 0 ${g.width} ${g.height}`}>
      <path className={styles.path} d={d} pathLength={1} style={{ stroke: c }} />
      {ball.outcome === "homeRun" ? <path className={styles.fence} d={`M${a0.x} ${a0.y}A${fence} ${fence} 0 0 1 ${a1.x} ${a1.y}`} pathLength={1} style={{ stroke: c }} /> : null}
      <g className={styles.landing} transform={`translate(${land.x} ${land.y})`}>
        {ball.outcome === "out" ? (
          <circle r={3.25} fill="none" strokeWidth={1.5} style={{ stroke: c }} />
        ) : ball.outcome === "homeRun" ? (
          <>
            <circle r={5} style={{ fill: c }} />
            <circle r={6.5} fill="none" strokeWidth={1} style={{ stroke: "var(--label)" }} />
          </>
        ) : (
          <circle r={4} style={{ fill: c }} />
        )}
        {ball.outcome !== "out" ? <circle className={styles.ping} r={6} fill="none" strokeWidth={1.5} style={{ stroke: c, "--reach": ball.outcome === "homeRun" ? 2.2 : 1.8 } as React.CSSProperties} /> : null}
      </g>
    </svg>
  );
}
