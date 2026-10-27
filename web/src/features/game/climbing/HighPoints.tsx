/**
 * High Points (LiveViews.swift `ClimbingWallView`): how high each climber
 * got on each route, as lanes on a hold-number scale. "45+" (held hold 45,
 * reaching for 46) shows as a short nub above the bar; a top runs to the TOP
 * line. More of the field as the wall widens (8 lanes, 9 from medium, 10
 * from large, 12 from xlarge); bars stay 12pt wide and lanes gain air. Your
 * countries' climbers fill in the accent.
 *
 * Live: the climber whose high point just rose is marked (a red dot, a soft
 * lane) for two minutes; new positions glide, growing bars ease. A climber
 * just topped plants their flag in place of TOP and sparks at the top of
 * their lane (no confetti: routes run at once, and a burst would compete).
 *
 * Linked: a lane under the pointer (or a climber lit in the results) lights;
 * the other lanes step back.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { SegmentedControl } from "../../../design/components";
import { WIDTH, useWidth } from "../../../design/useWidth";
import { holds, moving, topMomentID, type Climber, type WallRoute } from "../../../data/climbing";
import { countryName } from "../../../data/teams";
import { ordinal } from "../../../data/format";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell } from "../core/DetailSection";
import { useFocus, useLinkedStore, type Focus } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize } from "../core/useMedia";
import { useSettings } from "../../../state/settings";
import { flagColors } from "./marks";
import styles from "./Climbing.module.css";

// Plot geometry inside the well (points from the inner top).
const GUTTER = 26;
const TOP_LINE = 16;
const SCALE_TOP = 28;
const BASELINE = 148;
const HEIGHT = 182;

/** More of the field as the wall widens; bars stay 12 wide, lanes gain air. */
export function maxLanes(width: number): number {
  return width >= WIDTH.xlarge ? 12 : width >= WIDTH.large ? 10 : width >= WIDTH.medium ? 9 : 8;
}

const selectAthlete = (f: Focus | null) => f?.athlete ?? null;

export const HighPoints = memo(function HighPoints({ routes, live, yours }: { routes: readonly WallRoute[]; live: boolean; yours: ReadonlySet<string> }) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 340);
  const plotWidth = useWidth(plot, 320);
  const [selected, setSelected] = useState<string | null>(null);
  const route = routes.find((r) => r.name === selected) ?? routes[0];
  const moment = useChartMoment("wall");
  const level = useSettings((s) => s.celebrationLevel);
  const store = useLinkedStore();
  const lit = useFocus(selectAthlete);

  // The climber whose high point just rose is the one on the wall (marked for two minutes).
  const lastHeights = useRef<Map<number, number> | null>(null);
  const [movedAt, setMovedAt] = useState<ReadonlyMap<number, number>>(new Map());
  const heights = routes.flatMap((r) => r.climbers.map((c) => [c.id, c.top ? 999 : c.height] as const));
  const key = heights.map(([id, h]) => `${id}:${h}`).join(",");
  useEffect(() => {
    const now = new Map<number, number>();
    for (const [id, h] of heights) now.set(id, Math.max(now.get(id) ?? 0, h));
    const before = lastHeights.current;
    lastHeights.current = now;
    if (!before) return;
    const rose = [...now].filter(([id, h]) => h > (before.get(id) ?? h)).map(([id]) => id);
    if (rose.length > 0) setMovedAt((m) => new Map([...m, ...rose.map((id) => [id, Date.now()] as const)]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!route) return null;
  const lanes = route.climbers.slice(0, maxLanes(width));
  const held = Math.max(0, ...lanes.filter((c) => !c.top).map(holds));
  const scale = Math.max(10, Math.ceil((held + 1) / 10) * 10);
  const step = scale <= 20 ? 5 : 10;
  const y = (v: number) => BASELINE - (v / scale) * (BASELINE - SCALE_TOP);
  const laneWidth = (plotWidth - GUTTER) / Math.max(lanes.length, 1);
  const ids = new Set(lanes.map((c) => c.id));
  const litHere = lit != null && ids.has(lit) ? lit : null;
  const values: number[] = [];
  for (let v = step; v <= scale; v += step) values.push(v);
  const topIndex = moment?.kind === "top" ? lanes.findIndex((c) => topMomentID(c, route) === moment.id) : -1;
  const pt = typeof window === "undefined" ? 1 : pointSize();
  const example = route.climbers.find((c) => moving(c) && !c.top)?.height;
  const exampleHolds = example != null ? Math.floor(example) : 45;
  const hasYours = lanes.some((c) => c.country != null && yours.has(c.country));
  const remaining = Math.max(route.total - route.climbers.length, 0);

  return (
    <div ref={box} className={styles.chart}>
      {routes.length > 1 ? <SegmentedControl className={styles.picker} label="Route" value={route.name} options={routes.map((r) => ({ value: r.name, label: `Route ${r.name}` }))} onChange={(v) => setSelected(v)} /> : null}
      <VizWell>
        <div ref={plot} className={styles.plot} style={{ height: `calc(${HEIGHT} * var(--pt))` }}>
          {/* Scale: gridlines, the TOP line, the ground. */}
          <svg className={styles.svg} width="100%" height="100%" aria-hidden="true">
            {values.map((v) => (
              <line key={v} x1={GUTTER * pt} x2="100%" y1={y(v) * pt} y2={y(v) * pt} stroke="var(--viz-grid)" strokeWidth={0.5 * pt} />
            ))}
            <line x1={GUTTER * pt} x2="100%" y1={TOP_LINE * pt} y2={TOP_LINE * pt} stroke="var(--viz-reference)" strokeWidth={pt} />
            <line x1={GUTTER * pt} x2="100%" y1={BASELINE * pt} y2={BASELINE * pt} stroke="var(--viz-reference)" strokeWidth={pt} />
          </svg>
          <span className={`${styles.abs} ${styles.tick}`} style={{ transform: `translate(calc(${GUTTER - 4} * var(--pt)), calc(${TOP_LINE} * var(--pt))) translate(-100%, -50%)`, fontWeight: 600 }} aria-hidden="true">
            TOP
          </span>
          {values.map((v) => (
            <span key={v} className={`${styles.abs} ${styles.tick}`} style={{ transform: `translate(calc(${GUTTER - 4} * var(--pt)), calc(${y(v)} * var(--pt))) translate(-100%, -50%)` }} aria-hidden="true">
              {v}
            </span>
          ))}
          {lanes.map((c, index) => (
            <Lane
              key={c.id}
              climber={c}
              route={route}
              x={GUTTER + laneWidth * index}
              width={laneWidth}
              y={y}
              mine={c.country != null && yours.has(c.country)}
              current={live && Date.now() - (movedAt.get(c.id) ?? 0) < 120_000}
              planted={level !== "off" && c.top && moment?.kind === "top" && moment.id === topMomentID(c, route)}
              lit={litHere === c.id}
              receded={litHere != null && litHere !== c.id}
              onHover={(inside) => store?.hover({ athlete: c.id }, inside)}
            />
          ))}
          {topIndex >= 0 && moment ? (
            level === "off" ? (
              <span key={moment.id} className={`${styles.abs} ${styles.ping}`} style={{ transform: `translate(calc(${GUTTER + laneWidth * (topIndex + 0.5)} * var(--pt)), calc(${TOP_LINE} * var(--pt)))` }} />
            ) : (
              <div className={styles.stage}>
                <CelebrationStage moment={moment} origin={{ x: (GUTTER + laneWidth * (topIndex + 0.5)) * pt, y: TOP_LINE * pt }} colors={flagColors(lanes[topIndex]!.country)} />
              </div>
            )
          ) : null}
        </div>
      </VizWell>
      <ChartFooter readout={null} moment={moment}>
        <Legend>
          <LegendItem label={`${exampleHolds}+ held hold ${exampleHolds}, reaching for ${exampleHolds + 1}`} swatch={<LegendBar nub />} />
          <LegendItem label="Top reached the final hold" swatch={<LegendBar cap />} />
          {hasYours ? <LegendItem label="Your athletes" swatch={<span style={{ width: "calc(8 * var(--pt))", height: "calc(8 * var(--pt))", borderRadius: "calc(2 * var(--pt))", background: "var(--accent)" }} />} /> : null}
        </Legend>
      </ChartFooter>
      <p className={styles.status}>
        Top {Math.min(route.climbers.length, lanes.length)} of {route.total}
        {live && remaining > 0 ? ` · ${remaining} still to climb` : ""}
      </p>
    </div>
  );
});

function LegendBar({ nub = false, cap = false }: { nub?: boolean; cap?: boolean }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "calc(1 * var(--pt))" }}>
      {nub ? <span style={{ width: "calc(2 * var(--pt))", height: "calc(4 * var(--pt))", borderRadius: "calc(0.75 * var(--pt))", background: "color-mix(in srgb, var(--viz-neutral) 35%, transparent)" }} /> : null}
      {cap ? <span style={{ width: "calc(8 * var(--pt))", height: "calc(1.5 * var(--pt))", borderRadius: "999px", background: "var(--viz-neutral)" }} /> : null}
      <span style={{ width: "calc(5 * var(--pt))", height: `calc(${cap ? 9 : 8} * var(--pt))`, borderRadius: "calc(1 * var(--pt))", background: "var(--viz-neutral)" }} />
    </span>
  );
}

function Lane({ climber: c, route, x, width, y, mine, current, planted, lit, receded, onHover }: {
  climber: Climber;
  route: WallRoute;
  x: number;
  width: number;
  y: (v: number) => number;
  mine: boolean;
  current: boolean;
  planted: boolean;
  lit: boolean;
  receded: boolean;
  onHover: (inside: boolean) => void;
}) {
  const fillTop = c.top ? TOP_LINE : y(holds(c));
  const markTop = c.top ? TOP_LINE - 1 : moving(c) ? fillTop - 13 : fillTop;
  const surname = c.name.split(" ").at(-1) ?? c.name;
  const said = description(c, route);
  return (
    <div
      className={`${styles.abs} ${styles.lane}`}
      style={{ transform: `translateX(calc(${x} * var(--pt)))`, width: `calc(${width} * var(--pt))`, "--lane": mine ? "var(--accent)" : "var(--viz-neutral)" } as CSSProperties}
      data-lit={lit}
      data-dim={receded ? "receded" : undefined}
      role="img"
      aria-label={said}
      title={said}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHover(false)}
    >
      <span className={styles.laneWash} />
      {current ? <span className={styles.laneCurrent} /> : null}
      <span className={styles.laneTrack}>
        <span className={styles.laneFill} style={{ transform: `translateY(calc(${fillTop - TOP_LINE} * var(--pt)))` }} />
      </span>
      {/* "+": reaching for the next hold. */}
      {moving(c) && !c.top ? <span className={styles.laneNub} style={{ top: 0, transform: `translateY(calc(${fillTop - 13} * var(--pt)))` }} /> : null}
      {c.top ? <span className={styles.laneCap} /> : null}
      <span className={styles.laneValue} data-top={c.top && !planted} style={{ transform: `translateY(calc(${markTop - 9} * var(--pt))) translateY(-50%)` }}>
        {current ? <span className={styles.liveDot} /> : null}
        {/* Just topped: their flag planted on the top line, while it's news. */}
        {planted ? (
          <span className={styles.planted} title={`Topped Route ${route.name}`}>
            {c.flag ?? "⚑"}
          </span>
        ) : c.top ? (
          "TOP"
        ) : (
          c.label
        )}
      </span>
      <span className={styles.laneName}>
        <span className={styles.laneFlag}>{c.flag ?? ""}</span>
        <span className={styles.laneSurname}>{surname}</span>
      </span>
    </div>
  );
}

function description(c: Climber, route: WallRoute): string {
  const country = c.country ? countryName(c.country) : "";
  const height = c.top ? "topped the route" : moving(c) ? `hold ${holds(c)}, reaching for ${holds(c) + 1}` : `hold ${holds(c)}`;
  const place = c.rank != null ? `, ${ordinal(c.rank)} on Route ${route.name}` : "";
  return [c.name, country, height].filter(Boolean).join(", ") + place;
}
