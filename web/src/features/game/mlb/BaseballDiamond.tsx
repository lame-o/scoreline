/**
 * At the Plate (Visualizations.swift `BaseballDiamond`): the diamond with
 * its runners in the batting team's color, the count (balls, strikes, outs),
 * the batter and pitcher (each a link to their page), then the play theater,
 * whose caption is the footer under it: a pointed-at runner by name, else
 * what just happened at the plate, else the last play.
 *
 * Its beats: bases fill in order (first, second, third), so runners moving
 * up read as a sweep around the diamond; the base that loads them pops; a
 * double play draws the turn from second to first; a run lights home plate
 * in the scorer's color with a ring and sparks; a double play's outs land
 * one after the other. Off keeps the information and drops the motion;
 * Reduce Motion turns movement into fades.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ordinal } from "../../../data/format";
import type { Baseball } from "../../../data/gameDetail";
import type { Side } from "../../../data/models";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { useSettings } from "../../../state/settings";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter } from "../core/DetailSection";
import { useChartMoment } from "../core/moments";
import { popScale, sample } from "../../../data/celebrations";
import { useReducedMotion } from "../core/useMedia";
import { PlayerLink, type PlayerRef } from "../../profiles/ProfileLinks";
import styles from "./BaseballDiamond.module.css";

/** Home plate and the bases, in the diamond's 52 × 48 frame. */
const PLATE = { x: 26, y: 39 };
const FIRST = { x: 41, y: 24 };
const SECOND = { x: 26, y: 9 };

export interface BaseballDiamondProps {
  readonly situation: Baseball;
  /** The team at bat: its color fills the occupied bases. */
  readonly batting: Side | null;
  readonly palette: TeamPalette;
  /** A player's page (batter, pitcher). */
  /** A player's page from the feed's athlete ID and name (null: no page). */
  readonly player: (athleteID: string, name: string) => PlayerRef | null;
  /** Under the diamond, over the footer: the play theater. */
  readonly children?: ReactNode;
}

export function BaseballDiamond({ situation, batting, palette, player, children }: BaseballDiamondProps) {
  const moment = useChartMoment("plate");
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const [pointed, setPointed] = useState<number | null>(null);
  const color = (side: Side | null) => (side ? (side === "top" ? palette.top : palette.bottom) : null);
  /** A team with no usable color fills bases in ink, not gray. */
  const ink = (side: Side | null) => {
    const c = color(side);
    return c && c !== NEUTRAL ? c : null;
  };
  const battingColor = ink(batting) ?? "var(--label)";
  const scored = moment?.kind === "runScored" || moment?.kind === "homeRun";
  const plateColor = ink(moment?.side ?? null) ?? battingColor;
  const bases = [situation.onFirst, situation.onSecond, situation.onThird] as const;
  const loaded = bases.every(Boolean);

  // The base that loads them pops (1.25, staggered by base).
  const baseEls = useRef<(SVGRectElement | null)[]>([]);
  const before = useRef(bases);
  useEffect(() => {
    const old = before.current;
    before.current = bases;
    if (old.every(Boolean) || !bases.every(Boolean) || level !== "full" || reduce) return;
    bases.forEach((_, order) => {
      if (old[order]) return;
      baseEls.current[order]?.animate(
        sample((t) => popScale(t, 1.25, order * 0.04), 0.5 + order * 0.04).map(({ offset, value }) => ({ offset, transform: `rotate(45deg) scale(${value})` })),
        { duration: (0.5 + order * 0.04) * 1000 },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation.onFirst, situation.onSecond, situation.onThird]);

  // "Turn two": a line drawn from second toward first (0.25 s), then fading (0.3 s).
  const turn = useRef<SVGLineElement>(null);
  useEffect(() => {
    if (moment?.kind !== "doublePlay" || level === "off" || !turn.current) return;
    const el = turn.current;
    const length = Math.hypot(FIRST.x - SECOND.x, FIRST.y - SECOND.y);
    el.animate(
      reduce
        ? [{ strokeDashoffset: 0, opacity: 0 }, { strokeDashoffset: 0, opacity: 1, offset: 0.45 }, { strokeDashoffset: 0, opacity: 0 }]
        : [{ strokeDashoffset: length, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.45 }, { strokeDashoffset: 0, opacity: 0 }],
      { duration: 550, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [moment?.id, moment?.kind, level, reduce]);

  const runner = pointed != null && bases[pointed] ? situation.runners[pointed] : null;
  const readout = runner && pointed != null ? { lead: runner, detail: `Runner on ${ordinal(pointed + 1)}` } : null;
  const outStagger = moment?.kind === "doublePlay" ? 120 : 0;

  return (
    <div className={styles.atPlate}>
      <div className={styles.row} role="img" aria-label={spoken(situation)}>
        <div className={styles.diamond} aria-hidden="true">
          <svg viewBox="0 0 52 48" className={styles.svg}>
            {[
              { order: 1, at: SECOND },
              { order: 0, at: FIRST },
              { order: 2, at: { x: 11, y: 24 } },
            ].map(({ order, at }) => {
              const occupied = bases[order];
              const lit = occupied && pointed === order && situation.runners[order] != null;
              return (
                <g key={order} transform={`translate(${at.x} ${at.y})`}>
                  <rect
                    ref={(el) => {
                      baseEls.current[order] = el;
                    }}
                    className={styles.base}
                    x={-6.5}
                    y={-6.5}
                    width={13}
                    height={13}
                    rx={2}
                    data-on={occupied}
                    data-lit={lit}
                    style={{ "--fill": battingColor, transitionDelay: reduce ? "0ms" : `${order * 40}ms` } as CSSProperties}
                  />
                  {/* A target a little larger than the base. */}
                  <rect
                    x={-10}
                    y={-10}
                    width={20}
                    height={20}
                    fill="transparent"
                    onPointerEnter={(e) => e.pointerType === "mouse" && setPointed(order)}
                    onPointerLeave={() => setPointed((p) => (p === order ? null : p))}
                  />
                </g>
              );
            })}
            <line ref={turn} className={styles.turn} x1={SECOND.x} y1={SECOND.y} x2={FIRST.x} y2={FIRST.y} strokeDasharray={Math.hypot(15, 15)} />
            {/* Home plate, point down. */}
            <path
              className={styles.plate}
              data-scored={scored}
              style={{ "--plate": plateColor } as CSSProperties}
              d={`M${PLATE.x - 4} ${PLATE.y - 3.2}h8v3.6l-4 3.6-4-3.6z`}
            />
            {scored && level !== "off" ? <circle key={moment?.id} className={styles.ping} cx={PLATE.x} cy={PLATE.y} r={6} style={{ "--plate": plateColor } as CSSProperties} /> : null}
          </svg>
          {/* Runs score: sparks at the plate in the batting color (a home run's fireworks are the theater's). */}
          <CelebrationStage
            moment={moment?.kind === "runScored" ? moment : null}
            origin={moment?.kind === "runScored" ? { x: PLATE.x * ptScale(), y: PLATE.y * ptScale() } : null}
            colors={{ primary: color(moment?.side ?? batting) }}
            inset={10}
            radius={0}
            effects={[{ kind: "sparks", rays: 6, length: 12, base: 6 }]}
          />
        </div>
        <div className={styles.counts} aria-hidden="true">
          <Count label="B" value={situation.balls} of={3} tone="ball" help="Balls" />
          <Count label="S" value={situation.strikes} of={2} tone="strike" help="Strikes" />
          <Count label="O" value={situation.outs} of={2} tone="out" help="Outs" stagger={outStagger} />
        </div>
        <div className={styles.matchup}>
          {situation.batter ? <Matchup role="At bat" name={situation.batter} player={situation.batterID ? player(situation.batterID, situation.batter) : null} dot={color(batting)} chip={loaded} /> : null}
          {situation.pitcher ? (
            <Matchup role="Pitching" name={situation.pitcher} player={situation.pitcherID ? player(situation.pitcherID, situation.pitcher) : null} dot={color(batting === "top" ? "bottom" : batting === "bottom" ? "top" : null)} />
          ) : null}
        </div>
      </div>
      {children}
      <ChartFooter readout={readout} moment={moment}>
        {situation.lastPlay ? <p className={styles.lastPlay}>{situation.lastPlay}</p> : null}
      </ChartFooter>
    </div>
  );
}

/** The diamond's frame is in points; the stage's origin is in CSS pixels. */
function ptScale(): number {
  return typeof document === "undefined" ? 1 : parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1;
}

function Count({ label, value, of, tone, help, stagger = 0 }: { label: string; value: number; of: number; tone: "ball" | "strike" | "out"; help: string; stagger?: number }) {
  return (
    <span className={styles.count} title={`${help}: ${value}`}>
      <span className={styles.countLabel}>{label}</span>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={styles.countDot} data-tone={tone} data-on={i < value} style={{ transitionDelay: `${i * stagger}ms` }} />
      ))}
    </span>
  );
}

/** "At bat" with the batting team's dot (and BASES LOADED on the label's line, so nothing moves when it comes and goes). */
function Matchup({ role, name, player, dot, chip = false }: { role: string; name: string; player: PlayerRef | null; dot: string | null; chip?: boolean }) {
  return (
    <span className={styles.person}>
      <span className={styles.role}>
        {dot ? <span className={styles.teamDot} style={{ background: dot === NEUTRAL ? "var(--viz-neutral)" : dot }} /> : null}
        {role}
        {chip ? <span className={styles.chip}>BASES LOADED</span> : null}
      </span>
      {/* The name opens the player's page (PlayerNameLink: a dwell prefetches it); plain text without one. */}
      <PlayerLink player={player} variant="plain" className={styles.name}>
        {name}
      </PlayerLink>
    </span>
  );
}

function spoken(s: Baseball): string {
  const names = ["first", "second", "third"];
  const on = [s.onFirst, s.onSecond, s.onThird];
  const bases = names.flatMap((n, i) => (on[i] ? [s.runners[i] ? `${n} (${s.runners[i]})` : n] : []));
  const runners =
    bases.length === 0
      ? "Bases empty"
      : bases.length === 3 && s.runners.every((r) => r == null)
        ? "Bases loaded"
        : (bases.length === 3 ? "Bases loaded: " : "Runners on ") + bases.join(" and ");
  const matchup = [s.batter ? `${s.batter} batting` : null, s.pitcher ? `${s.pitcher} pitching` : null].filter(Boolean).join(", ");
  return `${s.balls} balls, ${s.strikes} strikes, ${s.outs} outs. ${runners}. ${matchup}`;
}
