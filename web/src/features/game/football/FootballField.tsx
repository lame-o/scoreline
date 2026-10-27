/**
 * The Field section (Visualizations.swift `FootballField`): a top-down field
 * where the top (away) team defends the left end zone. The drive in progress
 * is drawn snap by snap, each play a bar from where it started to where it
 * ended, newest at the bottom, over the line of scrimmage (blue), the line to
 * gain (yellow) and the red zone; the ball travels as the drive moves, with
 * an arrowhead toward the goal in the attacking team's color. Above it: who
 * has the ball, the down and distance, the RED ZONE and 2-MIN DRILL chips and
 * each team's timeouts. Under it: the footer (a pointed-at snap in words, else
 * what just happened, else the legend) and the drive, newest first.
 *
 * Its beats, each when the ball's own motion lands: a pass or kick hops the
 * ball; a sack drives it into the turf; a turnover knocks it as the
 * arrowhead sweeps round, with a ping in the new team's color; a big play
 * glints along its bar and throws sparks; a kick at the uprights flashes them
 * in the kicker's color (neutral if it's no good); a touchdown lights its end
 * zone and bursts into confetti from it (gold when it decides the game); a
 * field goal sparks at the back line; a safety blooms in the end zone it
 * happened in; entering the red zone, the tint breathes once. Off keeps the
 * information and drops the motion; Reduce Motion moves nothing and fades.
 *
 * Positions run in container units across the field (the field is a size
 * container), so marks move by transform on the compositor; the room cleared
 * around the ball (the lines and bars stop short of it) follows it as a mask.
 */
import { memo, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { Chip, Icon } from "../../../design/components";
import { sample, sweepCurve } from "../../../data/celebrations";
import type { Football } from "../../../data/gameDetail";
import { currentDrive, driveContaining, driveSummary, yardsText, type DrivePlay } from "../../../data/liveFeeds/football";
import { knockFrames, KNOCK_SECONDS } from "../../../data/matchRules";
import { scorer, Tier, type LiveMoment } from "../../../data/moments";
import type { Side } from "../../../data/models";
import { NEUTRAL, type TeamPalette } from "../../../data/teamColors";
import { WIDTH, useWidth } from "../../../design/useWidth";
import { useSettings } from "../../../state/settings";
import { CelebrationStage } from "../core/CelebrationStage";
import { ChartFooter, Legend, LegendItem, VizWell } from "../core/DetailSection";
import { useFocus, useLinkedRow, useLinkedStore } from "../core/linked";
import { useChartMoment } from "../core/moments";
import { pointSize, useReducedMotion } from "../core/useMedia";
import { textWidth } from "../../scores/measure";
import styles from "./FootballField.module.css";

/** One snap per row, 8pt apart; the field shows the last six. */
const ROW = 8;
const MAX_ROWS = 6;
/** The yard numbers' row under the field (4pt gap + 10): a burst may fall over it. */
const YARD_ROW = 14;
/** The end zones take 8% of the width each; x runs 0…100 across the field between them. */
const END_ZONE = 8;
const NONE: ReadonlySet<string> = new Set();

/** A yard line's place across the whole field, in container units (percent of its width). */
const at = (yard: number) => END_ZONE + ((100 - 2 * END_ZONE) * yard) / 100;

export interface FootballFieldProps {
  readonly situation: Football;
  /** Every snap the lane has seen, in play order (the field picks the drive). */
  readonly plays: readonly DrivePlay[];
  readonly names: { readonly top: string; readonly bottom: string };
  readonly spoken: { readonly top: string; readonly bottom: string };
  readonly palette: TeamPalette;
  /** Who has the ball now (the lane's view, else the situation's). */
  readonly possession: Side | null;
  readonly twoMinuteDrill: boolean;
  /** A play's words with its players' names as links. */
  readonly linkText?: (text: string) => ReactNode;
  /** False when the play theater owns the moment's burst (FootballCelebration.driveChartBursts); the marks still play. */
  readonly celebrates?: boolean;
}

export const FootballField = memo(function FootballField({ situation, plays, names, spoken, palette, possession, twoMinuteDrill, linkText, celebrates = true }: FootballFieldProps) {
  const moment = useChartMoment("field");
  const level = useSettings((s) => s.celebrationLevel);
  const reduce = useReducedMotion();
  const field = useRef<HTMLDivElement>(null);
  const width = useWidth(field, 340);

  // The drive on the field: the current one, or, while a score's moment shows,
  // the scoring drive (the extra point and kickoff can't clear it mid-moment).
  const scoreID = moment && moment.tier === Tier.score ? moment.id : null;
  const drive = useMemo(() => (scoreID ? driveContaining(plays, scoreID) : null) ?? currentDrive(plays), [plays, scoreID]);
  // Snaps on the field; kickoffs and punts stay in the list only.
  const rows = useMemo(() => drive.filter((p) => p.kind !== "kick").slice(-MAX_ROWS), [drive]);
  const momentPlay = moment ? (drive.find((p) => p.id === moment.id) ?? null) : null;
  const ballSide = possession ?? situation.possession;

  // After a score the ball stays where it happened for the moment's hold, then goes back to the spot.
  const ballX =
    moment && momentPlay && (moment.kind === "touchdown" || moment.kind === "fieldGoal")
      ? moment.kind === "fieldGoal"
        ? momentPlay.side === "bottom"
          ? 0
          : 100
        : momentPlay.endX
      : situation.ballX;
  // Room for the drive's rows plus one more: the ball waits on the next snap's row.
  const height = Math.max(56, 12 + (rows.length + 1) * ROW + 6);
  const ballY = rows.length === 0 ? height / 2 : 10 + rows.length * ROW;

  const ball = useRef<HTMLSpanElement>(null);
  const hop = useRef<HTMLSpanElement>(null);
  const uprights = useRef<HTMLSpanElement>(null);
  const redZone = useRef<HTMLSpanElement>(null);

  // A moment's marks, each when the ball's own motion lands (FootballField.marks).
  useEffect(() => {
    if (!moment || level === "off") return;
    const pt = pointSize();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (seconds: number, run: () => void) => timers.push(setTimeout(run, reduce ? 0 : seconds * 1000));
    if (!reduce) {
      // A pass or kick: the ball hops once on its way (in place, if incomplete).
      const peak = moment.kind === "passComplete" ? 8 : moment.kind === "passIncomplete" ? 5 : moment.kind === "fieldGoal" || moment.kind === "fieldGoalMissed" ? 14 : 0;
      if (peak > 0)
        hop.current?.animate(
          [
            { offset: 0, transform: "translateY(0)", easing: "cubic-bezier(0.33, 0, 0.67, 1)" },
            { offset: 0.45, transform: `translateY(${-peak * pt}px)`, easing: "cubic-bezier(0.33, 0, 0.67, 1)" },
            { offset: 1, transform: "translateY(0)" },
          ],
          { duration: 400 },
        );
      const amplitude = level === "subtle" ? 0.5 : 1;
      // A turnover knocks the ball as possession flips, first along the new attack direction.
      if (moment.kind === "turnover")
        after(0.3, () =>
          ball.current?.animate(
            knockFrames(3 * amplitude, ballSide === "bottom" ? -1 : 1).map(({ offset, value }) => ({ offset, transform: `translateX(${value * pt}px)` })),
            { duration: KNOCK_SECONDS * 1000, easing: "ease-in-out" },
          ),
        );
      // A sack drives it into the turf as it lands.
      if (moment.kind === "sack")
        after(0.2, () =>
          ball.current?.animate(
            knockFrames(1.5 * amplitude, 1).map(({ offset, value }) => ({ offset, transform: `translateY(${value * pt}px)` })),
            { duration: KNOCK_SECONDS * 1000, easing: "ease-in-out" },
          ),
        );
    }
    // A kick at the uprights: they flash at the back line (0 → 1 → 0 over 0.5 s).
    if (moment.kind === "fieldGoal" || moment.kind === "fieldGoalMissed")
      after(0.4, () =>
        uprights.current?.animate(
          [
            { offset: 0, opacity: 0, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
            { offset: 0.24, opacity: 1 },
            { offset: 0.44, opacity: 1, easing: "ease-in-out" },
            { offset: 1, opacity: 0 },
          ],
          { duration: 500 },
        ),
      );
    return () => timers.forEach(clearTimeout);
    // One set of marks per moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.id]);

  // Entering the red zone, the tint breathes once (up to 1.8× its tint, then settling at 1); at Off, a plain fade.
  const wasRedZone = useRef(situation.redZone);
  useEffect(() => {
    const was = wasRedZone.current;
    wasRedZone.current = situation.redZone;
    if (was || !situation.redZone || !redZone.current || moment?.tier === Tier.score) return;
    const rest = 1 / 1.8;
    redZone.current.animate(
      level !== "off" && !reduce
        ? [
            { offset: 0, opacity: 0, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
            { offset: 0.42, opacity: 1, easing: "ease-in-out" },
            { offset: 1, opacity: rest },
          ]
        : [{ opacity: 0 }, { opacity: rest }],
      { duration: level !== "off" && !reduce ? 600 : 150 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situation.redZone]);

  const color = (side: Side | null) => (side ? (side === "top" ? palette.top : palette.bottom) : null);
  const scoringSide = moment ? scorer(moment) : null;
  // A score lights the end zone it went into, in the scorer's color (a safety's:
  // the end zone the offense was tackled in, in the defense's). The top team attacks right.
  const washSide: Side | null = moment && ["touchdown", "fieldGoal", "safety"].includes(moment.kind) ? scoringSide : null;
  const washStrength = moment?.kind === "touchdown" ? 0.35 : 0.18;

  // The burst: from the scored-into end zone, the back line between the uprights, or the ball after a big play.
  const fieldPt = (yard: number) => (width * at(yard)) / 100;
  const stageOrigin = (() => {
    if (!moment) return null;
    const right = scoringSide === "top";
    const ez = (width * END_ZONE) / 100;
    switch (moment.kind) {
      case "touchdown":
      case "safety":
        return { x: right ? width - ez / 2 : ez / 2, y: height / 2 };
      case "fieldGoal":
        return { x: right ? width - 0.75 : 0.75, y: height / 2 };
      case "passComplete":
      case "rush":
        return moment.accents.has("bigPlay") ? { x: fieldPt(situation.ballX), y: ballY } : null;
      default:
        return null;
    }
  })();
  const bigPlaySparks = moment && (moment.kind === "passComplete" || moment.kind === "rush") && moment.accents.has("bigPlay");
  const px = pointSize();

  const kick = moment && (moment.kind === "fieldGoal" || moment.kind === "fieldGoalMissed") && moment.side ? { side: moment.side, good: moment.kind === "fieldGoal" } : null;
  const flag = moment?.kind === "penalty" && momentPlay ? momentPlay : null;
  const lit = useFocus((f) => (f?.play != null && rows.some((r) => r.id === f.play) ? f.play : null));
  // What was on the field when the page opened is history: only snaps from then on grow in.
  const opened = useRef<ReadonlySet<string> | null>(null);
  if (opened.current == null && plays.length > 0) opened.current = new Set(plays.map((p) => p.id));
  const initial = opened.current ?? NONE;
  const summary = driveSummary(rows, drive, ballSide, names);
  const travel = moment?.kind === "sack" ? "quick" : "travel";

  const ballStyle = { "--x": at(ballX), "--y": ballY } as CSSProperties;
  return (
    <div className={styles.field} aria-label={[situation.downDistance, situation.redZone ? "Red zone" : null, twoMinuteDrill ? "Two-minute drill" : null, summary].filter(Boolean).join(". ")} role="group">
      <Header situation={situation} names={names} spoken={spoken} palette={palette} side={ballSide} twoMinuteDrill={twoMinuteDrill} width={width + 16} />
      <VizWell padding={8}>
        <div ref={field} className={styles.turf} style={{ height: `calc(${height} * var(--pt))` }} data-motion={reduce ? "none" : travel} aria-hidden="true">
          <div className={styles.layers} style={{ "--bx": at(ballX), "--by": ballY } as CSSProperties}>
            <EndZone label={names.top} color={palette.top} side="left" />
            <EndZone label={names.bottom} color={palette.bottom} side="right" />
            <span className={styles.endWash} data-side="left" data-on={washSide === "bottom"} style={{ "--wash": color("bottom") ?? "transparent", "--strength": washStrength } as CSSProperties} />
            <span className={styles.endWash} data-side="right" data-on={washSide === "top"} style={{ "--wash": color("top") ?? "transparent", "--strength": washStrength } as CSSProperties} />
            {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yard) => (
              <span key={yard} className={styles.yardLine} data-mid={yard === 50} style={{ "--x": at(yard) } as CSSProperties} />
            ))}
            {situation.possession ? (
              <span ref={redZone} className={styles.redZone} data-on={situation.redZone} style={{ "--x": at(situation.possession === "top" ? 80 : 0), "--w": at(20) - at(0) } as CSSProperties} />
            ) : null}
            {rows.map((play, i) => (
              <DriveBar key={play.id} play={play} index={i} palette={palette} lit={lit === play.id} receded={lit != null && lit !== play.id} initial={opened.current == null || initial.has(play.id)} glint={moment?.id === play.id && moment.accents.has("bigPlay") && level === "full" && !reduce} />
            ))}
            {kick ? <span ref={uprights} className={styles.uprights} data-side={kick.side === "top" ? "right" : "left"} style={{ background: kick.good ? (color(kick.side) === NEUTRAL ? "var(--viz-neutral)" : color(kick.side)!) : "var(--viz-neutral)" }} /> : null}
            {situation.lineToGainX != null ? <span className={styles.lineToGain} style={{ "--x": at(situation.lineToGainX) } as CSSProperties} /> : null}
            <span className={styles.scrimmage} style={{ "--x": at(situation.ballX) } as CSSProperties} />
            {/* A flag, thrown in at the line of scrimmage. */}
            {flag ? <span key={flag.id} className={styles.flag} style={{ "--x": at(flag.startX) } as CSSProperties} /> : null}
          </div>
          {/* Which way they're going: an arrowhead on the ball, in their color; on a change of possession it sweeps round. */}
          {ballSide ? (
            <span className={styles.heading} style={ballStyle}>
              <span className={styles.chevron} data-side={ballSide} style={{ color: color(ballSide) === NEUTRAL ? "var(--viz-neutral)" : color(ballSide)! }}>
                <svg viewBox="0 0 6 6" aria-hidden="true">
                  <path d="M0.5 0.5 5.5 3 0.5 5.5z" fill="currentColor" />
                </svg>
              </span>
            </span>
          ) : null}
          <span className={styles.ball} style={ballStyle}>
            <span ref={ball} className={styles.ballKnock}>
              <span ref={hop} className={styles.ballHop}>
                <Icon name="football" size={10} />
              </span>
            </span>
          </span>
          {/* A turnover: "here", in the new team's color. */}
          {moment?.kind === "turnover" && ballSide && level !== "off" ? (
            <span key={moment.id} className={styles.ping} style={{ ...ballStyle, "--ping": color(ballSide) === NEUTRAL ? "var(--viz-neutral)" : color(ballSide)! } as CSSProperties} />
          ) : null}
          {/* The burst, over the marks, reaching down over the yard numbers to the well's edge. */}
          <div className={styles.stage} style={{ height: `calc(${height + YARD_ROW} * var(--pt))` }}>
            <CelebrationStage
              moment={stageOrigin && celebrates ? moment : null}
              origin={stageOrigin ? { x: stageOrigin.x * px, y: stageOrigin.y * px } : null}
              colors={{ primary: color(scoringSide) }}
              direction={((scoringSide === "top" ? -150 : -30) * Math.PI) / 180}
              inset={8}
              effects={bigPlaySparks ? [{ kind: "sparks", rays: 4, length: 9, base: 10 }] : undefined}
            />
          </div>
        </div>
        <div className={styles.yards} aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <span key={i} style={{ "--x": at(i * 10) } as CSSProperties}>
              {i <= 5 ? i * 10 : 100 - i * 10}
            </span>
          ))}
        </div>
      </VizWell>
      <FieldFooter rows={rows} moment={moment} redZone={situation.redZone} />
      {drive.length === 0 && situation.lastPlay ? <p className={styles.lastPlay}>{linkText ? linkText(situation.lastPlay) : situation.lastPlay}</p> : null}
      {drive.length > 0 ? <DriveList drive={drive} summary={summary} listed={width >= WIDTH.large ? MAX_ROWS : 4} initial={initial} linkText={linkText} /> : null}
    </div>
  );
});

/** Who has the ball (first: the thing a glance is for), the down and distance, the chips, and the timeouts. */
function Header({ situation, names, spoken, palette, side, twoMinuteDrill, width }: { situation: Football; names: FootballFieldProps["names"]; spoken: FootballFieldProps["spoken"]; palette: TeamPalette; side: Side | null; twoMinuteDrill: boolean; width: number }) {
  const team = side === "top" ? names.top : side === "bottom" ? names.bottom : null;
  const dot = side ? (side === "top" ? palette.top : palette.bottom) : null;
  const dd = situation.downDistance;
  const fit = headerFit({ team, dd, redZone: situation.redZone, drill: twoMinuteDrill, width });
  return (
    <div className={styles.header}>
      {team ? (
        <span className={styles.possessor} key={side}>
          <span className={styles.dot} style={{ background: dot === NEUTRAL ? "var(--viz-neutral)" : dot! }} />
          <span>{fit.ball ? `${team} ball` : team}</span>
          <span className="visually-hidden">{`, ${side === "top" ? spoken.top : spoken.bottom} have the ball`}</span>
        </span>
      ) : null}
      {team && dd ? (
        <span className={styles.separator} aria-hidden="true">
          ·
        </span>
      ) : null}
      {dd ? <span className={styles.down}>{fit.spot ? dd : (dd.split(" at ")[0] ?? dd)}</span> : null}
      {situation.redZone || twoMinuteDrill ? (
        <span className={styles.chips}>
          {situation.redZone ? (
            <Chip tone="state" title="Inside the opponent's 20">
              Red Zone
            </Chip>
          ) : null}
          {twoMinuteDrill ? (
            <span className={styles.drill} title="Two-minute drill: two minutes or less, one score down">
              {fit.drill ? "2-MIN DRILL" : "2 MIN"}
            </span>
          ) : null}
        </span>
      ) : null}
      <span className={styles.spacer} />
      <Timeouts count={situation.topTimeouts} color={palette.top} team={spoken.top} />
      <Timeouts count={situation.bottomTimeouts} color={palette.bottom} team={spoken.bottom} />
    </div>
  );
}

/**
 * What fits in the header row (the Mac's ViewThatFits with layout
 * priorities): the team keeps "ball" longest, then the down keeps its spot
 * (the field shows it), and the chips give way first ("2 MIN"). Measured from
 * the texts at the row's width, never per layout pass.
 */
export function headerFit({ team, dd, redZone, drill, width }: { team: string | null; dd: string | null; redZone: boolean; drill: boolean; width: number }): { ball: boolean; spot: boolean; drill: boolean } {
  const gap = 6;
  const chip = (text: string) => textWidth(text, 9, 700) + text.length * 0.5 + 12;
  // Two timeout groups (3 × 7 + 2 × 2 each) and the spacer's minimum.
  let room = width - 2 * 25 - gap - 4;
  const parts = (ball: boolean, spot: boolean, long: boolean) => {
    let used = 0;
    if (team) used += 7 + 4 + textWidth(ball ? `${team} ball` : team, 12, 600) + gap;
    if (team && dd) used += textWidth("·", 12, 600) + gap;
    if (dd) used += textWidth(spot ? dd : (dd.split(" at ")[0] ?? dd), 12, 600) + gap;
    if (redZone) used += chip("RED ZONE") + 4;
    if (drill) used += chip(long ? "2-MIN DRILL" : "2 MIN") + 4;
    return used;
  };
  room = Math.max(room, 0);
  for (const [ball, spot, long] of [
    [true, true, true],
    [true, true, false],
    [true, false, false],
    [false, false, false],
  ] as const) {
    if (parts(ball, spot, long) <= room) return { ball, spot, drill: long };
  }
  return { ball: false, spot: false, drill: false };
}

function Timeouts({ count, color, team }: { count: number | null; color: string; team: string }) {
  const n = count ?? 0;
  const label = `${team}: ${n} timeout${n === 1 ? "" : "s"} left`;
  return (
    <span className={styles.timeouts} title={label} role="img" aria-label={label}>
      {[0, 1, 2].map((i) => (
        <span key={i} data-on={i < n} style={i < n ? { background: color === NEUTRAL ? "var(--viz-neutral)" : color } : undefined} />
      ))}
    </span>
  );
}

function EndZone({ label, color, side }: { label: string; color: string; side: "left" | "right" }) {
  return (
    <span className={styles.endZone} data-side={side} style={{ "--team": color === NEUTRAL ? "var(--viz-neutral)" : color } as CSSProperties}>
      <span className={styles.endLabel}>{label}</span>
    </span>
  );
}

/**
 * A snap as a bar from its start to its end: a gain filled in the team's
 * color, a loss outlined in it (never red alone: a team's color may be red),
 * a penalty flag-yellow, a turnover neutral; a score ends in a dot. A big
 * play's bar glints once, the way it went.
 */
function DriveBar({ play, index, palette, lit, receded, initial, glint }: { play: DrivePlay; index: number; palette: TeamPalette; lit: boolean; receded: boolean; initial: boolean; glint: boolean }) {
  const store = useLinkedStore();
  const a = Math.min(play.startX, play.endX);
  const b = Math.max(play.startX, play.endX);
  const rightward = play.endX >= play.startX;
  const forward = play.side === "bottom" ? play.endX < play.startX : play.endX > play.startX;
  const team = play.side === "bottom" ? palette.bottom : palette.top;
  const flat = play.endX === play.startX;
  const tone = play.kind === "penalty" ? "var(--flag)" : play.kind === "turnover" || flat || team === NEUTRAL ? "var(--viz-neutral)" : team;
  const loss = play.kind === "sack" || (!flat && !forward && play.kind !== "penalty" && play.kind !== "turnover");
  const sweep = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!glint || !sweep.current) return;
    const el = sweep.current;
    const timer = setTimeout(() => {
      el.animate(
        sample(sweepCurve, 0.35).map(({ offset, value }) => ({ offset, transform: `translateX(${rightward ? -100 + 300 * value : 200 - 300 * value}%)`, opacity: value > 0 && value < 1 ? 1 : 0 })),
        { duration: 350, easing: "linear" },
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [glint, rightward]);
  return (
    <span
      className={styles.bar}
      data-lit={lit}
      data-receded={receded}
      style={{ "--x": at(a), "--w": at(b) - at(a), "--row": index } as CSSProperties}
      onPointerEnter={(e) => e.pointerType === "mouse" && store?.hover({ play: play.id }, true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && store?.hover({ play: play.id }, false)}
    >
      <span className={styles.capsule} data-loss={loss} data-kind={play.kind} data-dir={rightward ? "right" : "left"} data-initial={initial} style={{ "--tone": tone } as CSSProperties}>
        {glint ? <span ref={sweep} className={styles.sweep} /> : null}
        {play.kind === "score" ? <span className={styles.scoreDot} data-dir={rightward ? "right" : "left"} /> : null}
      </span>
    </span>
  );
}

/** The footer: a pointed-at snap in words, else what just happened, else the legend. Reads the focus, not the field. */
function FieldFooter({ rows, moment, redZone }: { rows: readonly DrivePlay[]; moment: LiveMoment | null; redZone: boolean }) {
  const focused = useFocus((f) => f?.play ?? null);
  const play = focused ? rows.find((r) => r.id === focused) : undefined;
  const readout = play ? { lead: yardsText(play.yards) ?? "No gain", detail: [play.downDistance, play.text].filter(Boolean).join(" · ") } : null;
  return (
    <ChartFooter readout={readout} moment={moment}>
      <Legend>
        <LegendItem label="Line of scrimmage" swatch={<span className={styles.swatchLine} data-tone="scrimmage" />} />
        <LegendItem label="First-down line" swatch={<span className={styles.swatchLine} data-tone="gain" />} />
        {rows.length > 0 ? (
          <>
            <LegendItem label="Gain" swatch={<span className={styles.swatchBar} />} />
            <LegendItem label="Loss" swatch={<span className={styles.swatchBar} data-loss="true" />} />
            {rows.some((r) => r.kind === "penalty") ? <LegendItem label="Penalty" swatch={<span className={styles.swatchBar} data-tone="flag" />} /> : null}
          </>
        ) : null}
        {redZone ? <LegendItem label="Red zone: inside the 20" swatch={<span className={styles.swatchZone} />} /> : null}
      </Legend>
    </ChartFooter>
  );
}

/** The drive, newest first: each snap slides in as it happens. The last 4, or from large up the last 6 (as many as the field draws). */
function DriveList({ drive, summary, listed, initial, linkText }: { drive: readonly DrivePlay[]; summary: string | null; listed: number; initial: ReadonlySet<string>; linkText?: (text: string) => ReactNode }) {
  const recent = drive.slice(-listed).reverse();
  return (
    <div className={styles.drive}>
      {summary ? <p className={styles.summary}>{summary}</p> : null}
      <ul className={styles.snaps}>
        {recent.map((play) => (
          <DriveRow key={play.id} play={play} initial={initial.has(play.id)} linkText={linkText} />
        ))}
      </ul>
    </div>
  );
}

function DriveRow({ play, initial, linkText }: { play: DrivePlay; initial: boolean; linkText?: (text: string) => ReactNode }) {
  const focus = useMemo(() => ({ play: play.id }), [play.id]);
  const row = useLinkedRow(focus, { pinnable: true, links: linkText != null });
  const lit = useFocus((f) => f?.play === play.id);
  const yards = yardsText(play.yards);
  // One element per snap: "2nd & 7, Mahomes pass to Kelce for 12 yards, plus 12".
  const spoken = [play.downDistance ?? play.clock, play.text, yards ? (play.yards > 0 ? `plus ${play.yards}` : `minus ${-play.yards}`) : null].filter(Boolean).join(", ");
  return (
    <li className={styles.snap} data-lit={lit} data-initial={initial} {...row} aria-label={linkText ? undefined : spoken}>
      <span className={styles.snapDown}>{play.downDistance ?? play.clock}</span>
      <span className={styles.snapText}>{linkText ? linkText(play.text) : play.text}</span>
      <span className={styles.snapYards} data-loss={play.yards < 0}>
        {yards ?? ""}
      </span>
    </li>
  );
}
