/**
 * On the Wall (LiveViews.swift `LeadAscentView`): lead, live, one route, one
 * climber at a time. The climber on the wall rises up one line, with
 * everyone who has already climbed marked where they reached. Passing
 * someone knocks their mark as the climber's dot reaches it (out, a dip, a
 * damped shake), then dims it and drops a ▼1 beside them; the climber's
 * place pops as it changes. A pointer marks the next climber to pass, and
 * the tip says how many holds that takes. A top plants the climber's flag
 * and sprays confetti in its colors down the wall. In a final, the podium
 * places wear medal colors. Between climbers, who's next.
 *
 * The dot rises on the travel spring (data/climbing.ts `travel`, as a CSS
 * easing), and each knock is timed to when the spring carries the dot across
 * that mark (`passFor`). Labels never overlap or leave the wall: close
 * heights stack downward with a leader line; a crowded round labels your
 * countries' climbers first, then the best placed, and the rest are ticks,
 * named under the pointer.
 *
 * Linked: a climber pointed at here, in the results or the starting order
 * lights; everyone else on the route steps back.
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ASCENT,
  climberID,
  heightLabel,
  holdsToGo,
  isFinalRound,
  labelCapacity,
  labeled,
  labelPositions,
  medalName,
  nextTarget,
  passFor,
  place,
  plotScale,
  type Climber,
  type Pass,
  type UpNext,
  type WallRoute,
} from "../../../data/climbing";
import { ordinal } from "../../../data/format";
import type { LiveMoment } from "../../../data/moments";
import { useSettings } from "../../../state/settings";
import { useWidth } from "../../../design/useWidth";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell } from "../core/DetailSection";
import { useFocus, useLinkedStore, type Focus } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize, useReducedMotion } from "../core/useMedia";
import { DeltaChip, flagColors, knock, pop, TRAVEL_EASING } from "./marks";
import styles from "./Climbing.module.css";

const at = (x: number, y: number, extra = ""): CSSProperties => ({ transform: `translate(calc(${x} * var(--pt)), calc(${y} * var(--pt)))${extra}` });
const selectAthlete = (f: Focus | null) => f?.athlete ?? null;

export interface LeadAscentProps {
  readonly route: WallRoute;
  readonly upNext: UpNext | null;
  /** IOC codes of your countries. */
  readonly yours: ReadonlySet<string>;
  readonly roundName: string | null;
}

export const LeadAscent = memo(function LeadAscent({ route, upNext, yours, roundName }: LeadAscentProps) {
  const plot = useRef<HTMLDivElement>(null);
  const width = useWidth(plot, 300);
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const moment = useChartMoment("ascent");
  const store = useLinkedStore();
  const final = isFinalRound(roundName);

  // One step taller from large: labels spread out, fewer need leader lines.
  const height = width + 20 >= 460 ? 300 : 250;
  const usable = height - ASCENT.topInset - ASCENT.bottomInset;
  const scale = plotScale(route);
  const y = (h: number) => ASCENT.topInset + (1 - Math.min(Math.max(h, 0), scale) / scale) * usable;
  const trackX = Math.round(width * 0.47);

  const onWall = route.climbers.find((c) => c.onWall) ?? null;
  // While their top is the news (and nobody else is on the wall), the climber who topped keeps the line.
  const topper = !onWall && moment?.kind === "top" ? (route.climbers.find((c) => c.id === climberID(moment) && c.top) ?? null) : null;
  const climbing = onWall ?? topper;
  const done = useMemo(() => route.climbers.filter((c) => !c.onWall && c.id !== topper?.id), [route.climbers, topper?.id]);
  const heightOf = (c: Climber) => (c.top ? scale : c.height);

  // MARK: The pass playing now

  const [pass, setPass] = useState<Pass | null>(null);
  const [flipped, setFlipped] = useState<string | null>(null);
  const [summit, setSummit] = useState<{ moment: string; flag: string | null } | null>(null);
  const previous = useRef<{ climber: number | null; height: number | null }>({ climber: null, height: null });
  const pill = useRef<HTMLSpanElement>(null);
  const begun = useRef<string | null>(null);
  useEffect(() => {
    const m = moment;
    if (!m || begun.current === m.id || !climbing || (m.kind !== "passed" && m.kind !== "top")) return;
    begun.current = m.id;
    const from = m.span?.[0] ?? (previous.current.climber === climbing.id ? previous.current.height : null) ?? heightOf(climbing);
    const next = passFor(m, climbing, from, done, scale, reduce);
    setPass(next);
    const root = plot.current;
    if (root && !reduce) {
      for (const k of next.knocks) {
        const el = root.querySelector(`[data-knock="${k.id}"]`);
        if (el) knock(el, { amplitude: 3, dip: 2, outward: -1, delay: k.at, level });
      }
    }
    if (pill.current && level === "full" && !reduce) pop(pill.current, 1.1, next.flip);
    if (m.kind === "top") setSummit({ moment: m.id, flag: climbing.flag });
    const timer = setTimeout(() => setFlipped(next.moment), next.flip * 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.id]);
  useEffect(() => {
    previous.current = { climber: climbing?.id ?? null, height: climbing ? heightOf(climbing) : null };
  });

  const livePass = pass && moment?.id === pass.moment ? pass : null;
  /** Until the dot passes its last mark, where they stood; after, where they are. */
  const standing = (c: Climber) => (livePass && livePass.climber === c.id && flipped !== livePass.moment ? { height: livePass.from, top: false } : { height: c.height, top: c.top });
  const passed = (c: Climber) => !!climbing && !c.top && (climbing.top || climbing.height > c.height);
  const lit = useFocus(selectAthlete);
  const litHere = lit != null && route.climbers.some((c) => c.id === lit) ? lit : null;

  // MARK: Labels

  const capacity = labelCapacity(height);
  const shown = labeled(done, yours, capacity);
  const labeledMarks = done.filter((c) => shown.has(c.id));
  const positions = labelPositions(
    labeledMarks.map((c) => y(heightOf(c))),
    ASCENT.labelGap,
    height - 8,
    ASCENT.topInset - 6,
  );
  const placed = new Map(labeledMarks.map((c, i) => [c.id, positions[i]!]));
  const hover = (id: number) => ({
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && store?.hover({ athlete: id }, true),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && store?.hover({ athlete: id }, false),
  });

  // MARK: The stage

  const pt = typeof window === "undefined" ? 1 : pointSize();
  const takesLead = (p: Pass) => done.length > 0 && place(p.from, false, done) > 1 && !!climbing && place(climbing.height, climbing.top, done) === 1;
  const stage = ((): { moment: LiveMoment; x: number; y: number; country: string | null } | null => {
    const m = moment;
    if (!m) return null;
    if (m.kind === "top") return { moment: m, x: trackX, y: y(scale), country: topper?.country ?? climbing?.country ?? null };
    if (m.kind === "passed" && livePass && climbing) {
      const accented = takesLead(livePass) && !m.accents.has("newLeader") ? { ...m, accents: new Set([...m.accents, "newLeader" as const]) } : m;
      return { moment: accented, x: trackX, y: y(livePass.to), country: climbing.country };
    }
    if (m.accents.has("decisive")) {
      // A decided final ("decided:<route>"): from the winner's mark.
      const winner = done.find((c) => String(c.id) === m.targets?.[0]) ?? done[0];
      return winner ? { moment: m, x: trackX, y: y(heightOf(winner)), country: winner.country } : null;
    }
    return null;
  })();
  const pingAt = ((): { x: number; y: number } | null => {
    if (level !== "off" || !moment) return null;
    if (moment.kind === "top") return { x: trackX, y: y(scale) };
    if (moment.kind === "passed") {
      const id = Number(moment.id.split(":").at(-1));
      const c = done.find((x) => x.id === id);
      return c ? { x: trackX, y: y(heightOf(c)) } : null;
    }
    return null;
  })();
  const planted = summit && moment?.id === summit.moment && level !== "off" ? summit : null;

  // MARK: Drawing

  const grid: number[] = [];
  for (let h = 10; h <= scale; h += 10) grid.push(h);
  const climbingHeight = climbing ? heightOf(climbing) : 0;
  const trackHeight = y(0) - y(scale);
  const target = climbing ? nextTarget(standing(climbing).height, standing(climbing).top, done) : null;
  const tipY = climbing ? Math.min(Math.max(y(climbingHeight), planted && climbing.id === topper?.id ? 38 : 24), height - 24) : 0;

  return (
    <div className={styles.chart} style={{ "--travel": TRAVEL_EASING } as CSSProperties} role="img" aria-label={spoken(climbing, done, upNext)}>
      <VizWell>
        <div ref={plot} className={styles.plot} style={{ height: `calc(${height} * var(--pt))` }} aria-hidden="true">
          {/* Every ten holds, faintly, numbered at the right edge. */}
          <svg className={styles.svg} width="100%" height="100%">
            {grid.map((h) => (
              <line key={h} x1={0} x2={Math.max(width - 16, 0) * pt} y1={y(h) * pt} y2={y(h) * pt} stroke="var(--viz-grid)" strokeWidth={0.5 * pt} strokeDasharray={`${2 * pt} ${3 * pt}`} />
            ))}
            {labeledMarks.map((c) => {
              const markY = y(heightOf(c));
              const labelY = placed.get(c.id)!;
              if (Math.abs(labelY - markY) <= 1.5) return null;
              return <line key={c.id} x1={(trackX - 8) * pt} y1={markY * pt} x2={(trackX - 14) * pt} y2={labelY * pt} stroke="var(--viz-grid)" strokeWidth={0.75 * pt} data-dim={dim(c, passed(c), litHere)} />;
            })}
          </svg>
          {grid.map((h) => (
            <span key={h} className={`${styles.abs} ${styles.tick}`} style={at(width, y(h), " translate(-100%, -50%)")}>
              {h}
            </span>
          ))}
          {/* The line, bottom to top; the climber's line fills it from the floor. */}
          <span className={`${styles.abs} ${styles.track}`} style={{ ...at(trackX - 2, y(scale)), height: `calc(${trackHeight} * var(--pt))` }}>
            {climbing ? <span className={styles.fill} style={{ transform: `translateY(calc(${(1 - Math.min(climbingHeight, scale) / scale) * trackHeight} * var(--pt)))` }} data-dim={litHere != null && litHere !== climbing.id ? "receded" : undefined} /> : null}
          </span>
          <span className={`${styles.abs} ${styles.tick} ${styles.topLabel}`} data-yield={planted != null} style={at(trackX, y(scale) - 10, " translate(-50%, -50%)")}>
            TOP
          </span>
          {done.map((c, index) => {
            const markY = y(heightOf(c));
            const labelY = placed.get(c.id);
            const mine = c.country != null && yours.has(c.country);
            const knockAt = livePass?.knocks.find((k) => k.id === c.id)?.at ?? null;
            const isPassed = passed(c);
            // In a final, a place on the podium for now (the climber on the wall counted).
            const medal = final ? medalName(index + 1 + (isPassed ? 1 : 0)) : null;
            const d = dim(c, isPassed, litHere);
            const delay = { "--delay": `${knockAt != null ? knockAt + 0.2 : 0}s` } as CSSProperties;
            return (
              <div key={c.id} className={`${styles.abs} ${styles.mark}`} style={{ ...at(0, 0), width: "100%" }}>
                <div data-knock={c.id} className={styles.abs} style={{ width: "100%" }}>
                  <span className={`${styles.abs} ${styles.markHit}`} style={at(trackX, markY)} {...hover(c.id)} title={labelY == null ? `${c.name} · ${c.label}` : undefined}>
                    <span className={`${styles.markTick} ${styles.dims}`} data-small={labelY == null} data-mine={mine} data-dim={d} style={delay} />
                    {reduce && knockAt != null ? <span key={livePass?.moment} className={styles.ring} style={{ "--delay": `${knockAt}s` } as CSSProperties} /> : null}
                  </span>
                  {labelY != null ? (
                    <span className={`${styles.abs} ${styles.label}`} data-mine={mine} data-lit={litHere === c.id} data-dim={d} style={{ ...at(0, labelY), width: `calc(${Math.max(trackX - 16, 0)} * var(--pt))`, ...delay }} {...hover(c.id)}>
                      {/* Passed just now: ▼1, the news about this climber (not dimmed). */}
                      {knockAt != null ? <DeltaChip delta={-1} className={styles.deltaIn} style={{ "--delay": `${knockAt}s` } as CSSProperties} /> : null}
                      {medal ? <span className={styles.medal} data-medal={medal} title={`${medal[0]!.toUpperCase()}${medal.slice(1)} place for now`} /> : null}
                      <span className={styles.labelName}>{`${c.flag ? `${c.flag} ` : ""}${c.name}`}</span>
                      <span className={styles.labelHeight}>{c.label}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
          {/* A lit climber without a label of their own: named beside their tick. */}
          {litHere != null && !placed.has(litHere) ? (() => {
            const c = done.find((x) => x.id === litHere);
            return c ? (
              <span className={`${styles.abs} ${styles.label} ${styles.plate}`} style={{ ...at(0, y(heightOf(c))), width: `calc(${Math.max(trackX - 16, 0)} * var(--pt))`, justifyContent: "flex-end" }}>
                <span className={styles.labelName}>{`${c.flag ? `${c.flag} ` : ""}${c.name}`}</span>
                <span className={styles.labelHeight}>{c.label}</span>
              </span>
            ) : null;
          })() : null}
          {climbing ? (
            <>
              {target ? <span className={`${styles.abs} ${styles.pointer}`} style={{ ...at(trackX + 10.5, y(heightOf(target))), width: "calc(5 * var(--pt))", height: "calc(6 * var(--pt))", background: "currentColor", clipPath: "polygon(100% 0, 0 50%, 100% 100%)" }} /> : null}
              <span className={`${styles.abs} ${styles.dot}`} style={at(trackX, y(climbingHeight))} data-dim={litHere != null && litHere !== climbing.id ? "receded" : undefined} {...hover(climbing.id)} />
              <Tip climber={climbing} standing={standing(climbing)} done={done} final={final} x={trackX + 15} y={tipY} width={width - trackX - 37} pill={pill} receded={litHere != null && litHere !== climbing.id} hover={hover(climbing.id)} />
            </>
          ) : upNext ? (
            <span className={`${styles.abs} ${styles.upNext}`} style={{ ...at(trackX + 12, y(0) - 8), width: `calc(${Math.max(width - trackX - 34, 0)} * var(--pt))` }}>
              Next: {upNext.flag ? `${upNext.flag} ` : ""}
              {upNext.name} · {upNext.position} of {upNext.total}
            </span>
          ) : null}
          {planted ? (
            <span key={planted.moment} className={`${styles.abs} ${styles.summit}`} style={at(trackX, y(scale))}>
              <span className={styles.pole} />
              <span className={styles.pennant} data-fallback={!planted.flag}>
                {planted.flag ?? "⚑"}
              </span>
            </span>
          ) : null}
          {pingAt && moment ? <span key={moment.id} className={`${styles.abs} ${styles.ping}`} style={at(pingAt.x, pingAt.y)} /> : null}
          <div className={styles.stage}>
            <CelebrationStage moment={stage?.moment ?? null} origin={stage ? { x: stage.x * pt, y: stage.y * pt } : null} colors={flagColors(stage?.country)} />
          </div>
        </div>
      </VizWell>
      <ChartFooter readout={null} moment={moment}>
        <Legend>
          <LegendItem label="Climbing" swatch={<span className={styles.legendLine} />} />
          <LegendItem label="High point" swatch={<span className={styles.legendTick} />} />
          <span className={styles.legendNote}>+ = moving to the next hold</span>
        </Legend>
      </ChartFooter>
    </div>
  );
});

/** A passed mark has stepped back; while another climber on the route is lit, the rest step back too. */
function dim(c: Climber, passed: boolean, lit: number | null): "passed" | "receded" | undefined {
  if (lit === c.id) return undefined;
  if (passed) return "passed";
  return lit != null ? "receded" : undefined;
}

/** The climber's label at the tip of their line: who, how high, what place, and what the next place takes. */
function Tip({ climber, standing, done, final, x, y, width, pill, receded, hover }: {
  climber: Climber;
  standing: { height: number; top: boolean };
  done: readonly Climber[];
  final: boolean;
  x: number;
  y: number;
  width: number;
  pill: React.RefObject<HTMLSpanElement | null>;
  receded: boolean;
  hover: React.HTMLAttributes<HTMLElement>;
}) {
  const at = place(standing.height, standing.top, done);
  const leads = at === 1 && done.length > 0;
  const medal = final ? medalName(at) : null;
  const label = standing.height === climber.height && standing.top === climber.top ? climber.label : heightLabel(standing.height, standing.top);
  const toGo = holdsToGo(standing.height, standing.top, done);
  return (
    <span className={`${styles.abs} ${styles.tip}`} style={{ transform: `translate(calc(${x} * var(--pt)), calc(${y} * var(--pt))) translateY(-50%)`, width: `calc(${Math.max(width, 0)} * var(--pt))` }} data-dim={receded ? "receded" : undefined} {...hover}>
      <span className={styles.tipName}>{`${climber.flag ? `${climber.flag} ` : ""}${climber.name}`}</span>
      <span className={styles.tipLine}>
        <span className={styles.tipHeight}>{label}</span>
        <span ref={pill} className={styles.place} data-medal={medal ?? undefined} title={medal ? `${medal[0]!.toUpperCase()}${medal.slice(1)} medal place for now` : undefined}>
          {leads ? "Leads" : ordinal(at)}
        </span>
      </span>
      {toGo ? <span className={styles.toGo}>{toGo}</span> : null}
    </span>
  );
}

function spoken(climbing: Climber | null, done: readonly Climber[], upNext: UpNext | null): string {
  const parts: string[] = [];
  if (climbing) {
    let line = `${climbing.name} is climbing, at ${climbing.label}, ${ordinal(place(climbing.height, climbing.top, done))} for now.`;
    const toGo = holdsToGo(climbing.height, climbing.top, done);
    if (toGo) line += ` ${toGo}.`;
    parts.push(line);
  } else if (upNext) {
    parts.push(`Next up: ${upNext.name}.`);
  }
  parts.push(...done.slice(0, 8).map((c) => `${c.name} ${c.label}`));
  return parts.join(" ");
}
