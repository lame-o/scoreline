/**
 * The strip a large live tile draws under the score, from data the
 * scoreboard already carries (TileStrips.swift). One per sport:
 * - Football: the field as a bar, end zones in team colors, the ball above
 *   the line of scrimmage with a chevron toward the goal, the line to gain,
 *   the red zone.
 * - Baseball: the bases (filled when occupied) and the count.
 * - Soccer: the match on one line: time played, half-time, each team's
 *   goals in its own lane, red cards.
 * - Basketball: the margin as a bar toward the leading side.
 * Strips have no hover targets of their own (the tile is the link); what
 * they show is in the tile's label (`stripMeaning`).
 */
import { useId, type CSSProperties } from "react";
import { Icon } from "../../design/components";
import type { BaseState, FootballSpot, MatchMark, ScoreEvent } from "../../data/models";
import { markMinute, surname } from "../../data/soccer";
import { ordinal } from "../../data/format";
import type { TeamPalette } from "../../data/teamColors";
import styles from "./TileStrips.module.css";

/** Whether the event has a strip to draw. */
export function hasStrip(event: ScoreEvent): boolean {
  switch (event.snapshot?.kind) {
    case "football":
    case "baseball":
    case "soccer":
      return true;
    case "basketball":
      return event.content.kind === "match" && event.content.top.score != null && event.content.bottom.score != null;
    default:
      return false;
  }
}

export function TileStrip({ event, palette }: { event: ScoreEvent; palette: TeamPalette }) {
  const s = event.snapshot;
  if (!s) return null;
  switch (s.kind) {
    case "football":
      return <FieldStrip spot={s.spot} palette={palette} />;
    case "baseball":
      return <BasesStrip state={s.bases} />;
    case "soccer":
      return <GoalTrack marks={s.marks} minute={soccerMinute(event)} palette={palette} />;
    case "basketball": {
      if (event.content.kind !== "match") return null;
      const a = Number(event.content.top.score);
      const b = Number(event.content.bottom.score);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return <LeadBar margin={a - b} top={event.content.top.abbreviation} bottom={event.content.bottom.abbreviation} palette={palette} />;
    }
    default:
      return null;
  }
}

const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

// MARK: - Football

/** Field x (0…100, from the left goal line) as a percentage of the strip; end zones are 10 yards each side. */
const fieldPct = (x: number) => ((x + 10) / 120) * 100;

function FieldStrip({ spot, palette }: { spot: FootballSpot; palette: TeamPalette }) {
  const attacksLeft = spot.possession === "bottom";
  const los = fieldPct(spot.ballX);
  const gain = spot.lineToGainX != null ? fieldPct(spot.lineToGainX) : null;
  const redZoneFrom = attacksLeft ? fieldPct(0) : fieldPct(80);
  const clip = useId();
  return (
    <div className={styles.strip}>
      <svg className={styles.svg} viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id={clip}>
            <rect x="0" y="20" width="120" height="8" rx="2" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y="20" width="120" height="8" fill="var(--viz-track)" />
          <rect x="0" y="20" width="10" height="8" fill={tint(palette.top, 25)} />
          <rect x="110" y="20" width="10" height="8" fill={tint(palette.bottom, 25)} />
          {spot.redZone ? <rect x={(redZoneFrom / 100) * 120} y="20" width="20" height="8" fill="var(--live-wash)" /> : null}
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((yard) => (
            <rect key={yard} x={yard + 10 - (yard === 50 ? 0.25 : 0.12)} y="20" width={yard === 50 ? 0.5 : 0.25} height="8" fill={yard === 50 ? "var(--viz-reference)" : "var(--viz-grid)"} />
          ))}
          {gain != null ? <rect x={(gain / 100) * 120 - 0.35} y="20" width="0.7" height="8" fill="#ffcc00" /> : null}
          <rect x={(los / 100) * 120 - 0.35} y="20" width="0.7" height="8" fill="#0a84ff" />
        </g>
      </svg>
      <span className={`${styles.at} ${styles.ball}`} style={{ "--x": los, top: "calc(13 * var(--pt))" } as CSSProperties}>
        <Icon name="football" size={8} />
      </span>
      {spot.possession ? (
        <span
          className={styles.at}
          style={
            {
              "--x": los,
              top: "calc(13 * var(--pt))",
              marginLeft: `calc(${attacksLeft ? -8.5 : 8.5} * var(--pt))`,
              color: attacksLeft ? palette.bottom : palette.top,
            } as CSSProperties
          }
        >
          <svg viewBox="0 0 6 6" style={{ width: "calc(5 * var(--pt))", height: "calc(5 * var(--pt))", display: "block" }} aria-hidden="true">
            <path d={attacksLeft ? "M5.5 0.5 0.5 3 5.5 5.5z" : "M0.5 0.5 5.5 3 0.5 5.5z"} fill="currentColor" />
          </svg>
        </span>
      ) : null}
    </div>
  );
}

// MARK: - Baseball

function BasesStrip({ state }: { state: BaseState }) {
  const base = (on: boolean, x: number, y: number) => <span className={styles.base} data-on={on} style={{ left: `calc(${x} * var(--pt))`, top: `calc(${y} * var(--pt))` }} />;
  const pips = (label: string, value: number, of: number, color: string) => (
    <span className={styles.count}>
      {label}
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={styles.pip} style={i < value ? { background: color, boxShadow: "none" } : undefined} />
      ))}
    </span>
  );
  return (
    <div className={`${styles.strip} ${styles.bases}`} aria-hidden="true">
      <span className={styles.diamond}>
        {base(state.onSecond, 15, 7)}
        {base(state.onFirst, 25, 14)}
        {base(state.onThird, 5, 14)}
        <span className={styles.plate} />
      </span>
      <span className={styles.counts}>
        {pips("B", state.balls, 3, "#34c759")}
        {pips("S", state.strikes, 2, "#ff9f0a")}
        {pips("O", state.outs, 2, "var(--live)")}
      </span>
    </div>
  );
}

// MARK: - Soccer

/** The match minute from the polled clock ("67'", "45'+2'", HT). */
export function soccerMinute(event: ScoreEvent): number | null {
  const clock = event.clock;
  if (!clock) return null;
  if (clock.display.toUpperCase() === "HT") return 45;
  return markMinute(clock.display) ?? clock.seconds / 60;
}

function GoalTrack({ marks, minute, palette }: { marks: readonly MatchMark[]; minute: number | null; palette: TeamPalette }) {
  const end = Math.max(90, minute ?? 0, ...marks.map((m) => m.minute));
  const inset = 2;
  const x = (m: number) => inset + (Math.min(Math.max(m, 0), end) / end) * (120 - 2 * inset);
  const mid = 14;
  const lane = 6.5;
  return (
    <div className={styles.strip} aria-hidden="true">
      <svg className={styles.svg} viewBox="0 0 120 28" preserveAspectRatio="none">
        <rect x={inset} y={mid - 0.5} width={120 - 2 * inset} height="1" fill="var(--viz-track)" />
        {minute != null ? <rect x={inset} y={mid - 0.5} width={x(minute) - inset} height="1" fill="var(--viz-reference)" /> : null}
        <rect x={x(45) - 0.2} y={mid - 4} width="0.4" height="8" fill="var(--viz-reference)" />
      </svg>
      {marks.map((m, i) => {
        const color = m.side === "top" ? palette.top : m.side === "bottom" ? palette.bottom : "var(--label)";
        const top = m.side === "top" ? mid - lane : m.side === "bottom" ? mid + lane : mid;
        const card = m.kind === "redCard";
        return (
          <span
            key={`${m.kind}-${m.minute}-${i}`}
            className={styles.at}
            style={{
              "--x": (x(m.minute) / 120) * 100,
              top: `calc(${top} * var(--pt))`,
              width: card ? "calc(4 * var(--pt))" : "calc(7 * var(--pt))",
              height: card ? "calc(6 * var(--pt))" : "calc(7 * var(--pt))",
              borderRadius: card ? "calc(1 * var(--pt))" : "50%",
              background: card ? "var(--live)" : color,
              boxShadow: m.kind === "ownGoal" ? "inset 0 0 0 1.5px var(--page)" : undefined,
            } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

// MARK: - Basketball

function LeadBar({ margin, top, bottom, palette }: { margin: number; top: string; bottom: string; palette: TeamPalette }) {
  // Scale to 20 points: a 20-point lead fills its half.
  const share = Math.min(Math.abs(margin), 20) / 20;
  const width = share * 50;
  const color = margin > 0 ? palette.top : palette.bottom;
  return (
    <div className={`${styles.strip} ${styles.lead}`} aria-hidden="true">
      <span>{top}</span>
      <span className={styles.leadTrack}>
        <span
          className={styles.leadBar}
          style={{
            left: margin > 0 ? 0 : "50%",
            transformOrigin: margin > 0 ? "right" : "left",
            transform: `scaleX(${margin === 0 ? 0 : width / 50})`,
            background: color,
          }}
        />
      </span>
      <span>{bottom}</span>
    </div>
  );
}

// MARK: - Words

/** What the strip shows, in words, for the tile's label (TileStripView.meaning). */
export function stripMeaning(event: ScoreEvent): string | null {
  const s = event.snapshot;
  if (!s || event.content.kind !== "match") return null;
  const { top, bottom } = event.content;
  switch (s.kind) {
    case "football": {
      const team = s.spot.possession === "top" ? top.name : s.spot.possession === "bottom" ? bottom.name : null;
      return [team ? `${team} ball` : null, event.liveLine, s.spot.redZone ? "red zone" : null].filter(Boolean).join(", ") || null;
    }
    case "baseball": {
      const b = s.bases;
      const bases = (
        [
          [b.onFirst, "first"],
          [b.onSecond, "second"],
          [b.onThird, "third"],
        ] as const
      )
        .filter(([on]) => on)
        .map(([, n]) => n);
      const runners = bases.length === 0 ? "Bases empty" : `Runners on ${bases.join(" and ")}`;
      return `${runners}. ${b.balls} balls, ${b.strikes} strikes, ${b.outs} out${b.outs === 1 ? "" : "s"}`;
    }
    case "soccer": {
      const goal = [...s.marks].reverse().find((m) => m.kind !== "redCard");
      if (!goal) return null;
      return `Last goal ${goal.player ? surname(goal.player) : "unknown"}, ${ordinal(Math.trunc(goal.minute))} minute${goal.kind === "penalty" ? ", penalty" : goal.kind === "ownGoal" ? ", own goal" : ""}`;
    }
    case "basketball": {
      const a = Number(top.score);
      const b = Number(bottom.score);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return a === b ? "Tied" : `${a > b ? top.name : bottom.name} leads by ${Math.abs(a - b)}`;
    }
    default:
      return null;
  }
}
