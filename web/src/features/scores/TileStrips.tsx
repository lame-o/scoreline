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
 * - CS2: the map being played as a race to 13 (overtime: to 4 per block).
 * Strips have no hover targets of their own (the tile is the link); what
 * they show is in the tile's label (`stripMeaning`).
 *
 * Live moments (landing-views §6.6), each a layer that exists only while it
 * plays and moves by opacity or transform alone, and only on a visible page
 * (a tab in the background just shows the new state): a touchdown lights
 * the end zone it went into in the scorer's color on the flash's timings; a
 * change of possession sweeps the chevron 180° over the ball; a run scoring
 * pings home plate; a goal arrives like a badge and pings in its team's
 * color; a map won empties the race with a ghost of the won cells fading.
 * Reduce Motion: the sweep crossfades and the pings fade where they are.
 */
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Icon } from "../../design/components";
import type { BaseState, CSLive, FootballSpot, MatchMark, ScoreEvent } from "../../data/models";
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
    case "counterStrike":
      return true;
    default:
      return false;
  }
}

/** Both sides' points, for strips that react to a score (StripPoints). */
function points(event: ScoreEvent): { top: number | null; bottom: number | null } {
  if (event.content.kind !== "match") return { top: null, bottom: null };
  const n = (v: string | null) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  return { top: n(event.content.top.score), bottom: n(event.content.bottom.score) };
}

/** Moments play only where someone sees them. */
const onScreen = () => typeof document !== "undefined" && document.visibilityState === "visible";

/** The value from the last render (null on the first), so a moment fires only on a change seen live. */
function usePrevious<T>(value: T): T | null {
  const ref = useRef<{ value: T } | null>(null);
  const previous = ref.current?.value ?? null;
  useEffect(() => {
    ref.current = { value };
  });
  return previous;
}

/** A moment's layer: the latest one, keyed by its own number, gone once its animation ends. */
function useMoment<T>() {
  const [moment, setMoment] = useState<{ id: number; value: T } | null>(null);
  const count = useRef(0);
  const play = (value: T) => setMoment({ id: ++count.current, value });
  const done = (id: number) => setMoment((m) => (m?.id === id ? null : m));
  return { moment, play, done };
}

export function TileStrip({ event, palette }: { event: ScoreEvent; palette: TeamPalette }) {
  const s = event.snapshot;
  if (!s) return null;
  switch (s.kind) {
    case "football": {
      const p = points(event);
      return <FieldStrip spot={s.spot} palette={palette} top={p.top} bottom={p.bottom} />;
    }
    case "baseball": {
      const p = points(event);
      return <BasesStrip state={s.bases} runs={p.top != null && p.bottom != null ? p.top + p.bottom : null} />;
    }
    case "soccer":
      return <GoalTrack marks={s.marks} minute={soccerMinute(event)} palette={palette} />;
    case "counterStrike":
      return <RaceStrip live={s.live} palette={palette} />;
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

/** The possession chevron, pointing where the offense goes. */
function Chevron({ left, color }: { left: boolean; color: string }) {
  return (
    <svg viewBox="0 0 6 6" style={{ width: "calc(5 * var(--pt))", height: "calc(5 * var(--pt))", display: "block", color }} aria-hidden="true">
      <path d={left ? "M5.5 0.5 0.5 3 5.5 5.5z" : "M0.5 0.5 5.5 3 0.5 5.5z"} fill="currentColor" />
    </svg>
  );
}

function FieldStrip({ spot, palette, top, bottom }: { spot: FootballSpot; palette: TeamPalette; top: number | null; bottom: number | null }) {
  const attacksLeft = spot.possession === "bottom";
  const los = fieldPct(spot.ballX);
  const gain = spot.lineToGainX != null ? fieldPct(spot.lineToGainX) : null;
  const redZoneFrom = attacksLeft ? fieldPct(0) : fieldPct(80);
  const clip = useId();

  // A side up by six or more in one update scored a touchdown; the ball changing hands sweeps the chevron.
  const touchdown = useMoment<"top" | "bottom">();
  const sweep = useMoment<{ toLeft: boolean }>();
  const before = usePrevious({ top, bottom, possession: spot.possession });
  useEffect(() => {
    if (!before || !onScreen()) return;
    if (before.top != null && top != null && top - before.top >= 6) touchdown.play("top");
    else if (before.bottom != null && bottom != null && bottom - before.bottom >= 6) touchdown.play("bottom");
    if (before.possession && spot.possession && before.possession !== spot.possession) sweep.play({ toLeft: spot.possession === "bottom" });
    // Only a change of the readings plays a moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top, bottom, spot.possession]);
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
      {touchdown.moment ? (
        // The top team attacks right, so its touchdowns land in the right end zone.
        <span
          key={touchdown.moment.id}
          className={styles.endZone}
          data-side={touchdown.moment.value === "top" ? "right" : "left"}
          style={{ background: tint(touchdown.moment.value === "top" ? palette.top : palette.bottom, 45) }}
          onAnimationEnd={() => touchdown.done(touchdown.moment!.id)}
          aria-hidden="true"
        />
      ) : null}
      <span className={`${styles.at} ${styles.ball}`} style={{ "--x": los, top: "calc(13 * var(--pt))" } as CSSProperties}>
        <Icon name="football" size={8} />
        {sweep.moment ? (
          // Old side to new, over the top of the ball, taking the other team's color as it goes.
          <span key={sweep.moment.id} className={styles.sweep} data-to={sweep.moment.value.toLeft ? "left" : "right"} onAnimationEnd={(e) => e.target === e.currentTarget && sweep.done(sweep.moment!.id)}>
            <span className={styles.sweepFrom}>
              <Chevron left={!sweep.moment.value.toLeft} color={sweep.moment.value.toLeft ? palette.top : palette.bottom} />
            </span>
            <span className={styles.sweepTo}>
              <Chevron left={!sweep.moment.value.toLeft} color={sweep.moment.value.toLeft ? palette.bottom : palette.top} />
            </span>
          </span>
        ) : null}
      </span>
      {spot.possession && !sweep.moment ? (
        <span
          className={styles.at}
          style={
            {
              "--x": los,
              top: "calc(13 * var(--pt))",
              marginLeft: `calc(${attacksLeft ? -8.5 : 8.5} * var(--pt))`,
            } as CSSProperties
          }
        >
          <Chevron left={attacksLeft} color={attacksLeft ? palette.bottom : palette.top} />
        </span>
      ) : null}
    </div>
  );
}

// MARK: - Baseball

function BasesStrip({ state, runs }: { state: BaseState; runs: number | null }) {
  // Each rise in the runs (both teams together) is a run scored: home plate pings once.
  const ping = useMoment<number>();
  const before = usePrevious(runs);
  useEffect(() => {
    if (before != null && runs != null && runs > before && onScreen()) ping.play(runs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);
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
        {ping.moment ? <span key={ping.moment.id} className={styles.ping} style={{ left: "50%", top: "calc(24.5 * var(--pt))", width: "calc(8 * var(--pt))", height: "calc(8 * var(--pt))", color: "var(--label)" }} onAnimationEnd={() => ping.done(ping.moment!.id)} /> : null}
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

const markKey = (m: MatchMark) => `${m.kind}-${m.minute}-${m.side ?? "none"}`;

function GoalTrack({ marks, minute, palette }: { marks: readonly MatchMark[]; minute: number | null; palette: TeamPalette }) {
  // The marks already drawn; a new one arrives like a badge, and a goal pings in its team's color.
  const seen = useRef<Set<string> | null>(null);
  const arriving = useRef(new Set<string>());
  const ping = useMoment<MatchMark>();
  if (seen.current == null) seen.current = new Set(marks.map(markKey));
  const fresh = marks.filter((m) => !seen.current!.has(markKey(m)));
  if (fresh.length > 0 && onScreen()) for (const m of fresh) arriving.current.add(markKey(m));
  useEffect(() => {
    if (fresh.length === 0) return;
    for (const m of fresh) seen.current!.add(markKey(m));
    // The latest of what's new (one poll can bring two).
    const goal = [...fresh].filter((m) => m.kind !== "redCard").sort((a, b) => b.minute - a.minute)[0];
    if (goal && onScreen()) ping.play(goal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks]);
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
        const key = markKey(m);
        return (
          <span
            key={`${key}-${i}`}
            className={styles.at}
            data-arriving={arriving.current.has(key) || undefined}
            onAnimationEnd={() => arriving.current.delete(key)}
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
      {ping.moment ? (
        <span key={ping.moment.id} className={styles.markPing} style={{ "--x": (x(ping.moment.value.minute) / 120) * 100, top: `calc(${ping.moment.value.side === "top" ? mid - lane : ping.moment.value.side === "bottom" ? mid + lane : mid} * var(--pt))` } as CSSProperties}>
          <span
            className={styles.ping}
            style={{ left: "50%", top: "50%", width: "calc(9 * var(--pt))", height: "calc(9 * var(--pt))", color: ping.moment.value.side === "top" ? palette.top : ping.moment.value.side === "bottom" ? palette.bottom : "var(--label)" }}
            onAnimationEnd={() => ping.done(ping.moment!.id)}
          />
        </span>
      ) : null}
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

// MARK: - CS2

export interface Race {
  /** Cells per side: 13 in regulation (MR12), 4 in an overtime block. */
  readonly cells: number;
  readonly top: number;
  readonly bottom: number;
  readonly label: string | null;
}

/** The race the map is: first to 13; from 12–12, overtime blocks of six, first to 4 (RaceStrip.race). */
export function raceOf(live: CSLive): Race {
  const t = live.topScore;
  const b = live.bottomScore;
  if (!(t >= 12 && b >= 12)) return { cells: 13, top: Math.min(t, 13), bottom: Math.min(b, 13), label: live.round != null ? `Round ${live.round}` : null };
  const block = Math.max(0, Math.floor((Math.min(t, b) - 12) / 3));
  return {
    cells: 4,
    top: Math.min(t - 12 - 3 * block, 4),
    bottom: Math.min(b - 12 - 3 * block, 4),
    label: block > 0 ? `Overtime ${block + 1}` : "Overtime",
  };
}

/**
 * The map being played as a race to 13: each team fills its half from the
 * outside in; first to the middle takes the map. The main score stays maps,
 * so the map's name is always here.
 */
function RaceStrip({ live, palette }: { live: CSLive; palette: TeamPalette }) {
  const race = raceOf(live);
  return (
    <div className={`${styles.strip} ${styles.race}`} aria-hidden="true">
      <span className={styles.raceHead}>
        <span className={styles.raceMap}>{live.mapName ?? `Map ${live.mapNumber ?? 1}`}</span>
        {race.label ? <span className={styles.raceLabel}>{race.label}</span> : null}
      </span>
      <span className={styles.raceRow}>
        <span className={styles.raceScore}>{live.topScore}</span>
        <RaceCells count={race.cells} filled={race.top} color={palette.top} fromLeading />
        <span className={styles.raceMid} />
        <RaceCells count={race.cells} filled={race.bottom} color={palette.bottom} fromLeading={false} />
        <span className={styles.raceScore} style={{ textAlign: "right" }}>
          {live.bottomScore}
        </span>
      </span>
    </div>
  );
}

/**
 * One team's half. A round won fills the next cell (a fade of its fill). A
 * map won (or an overtime block ending) starts the race over: the cells
 * empty at once and a ghost of the won cells fades out over them, leaving
 * faster than it arrived.
 */
function RaceCells({ count, filled, color, fromLeading }: { count: number; filled: number; color: string; fromLeading: boolean }) {
  const ghost = useMoment<{ count: number; filled: number }>();
  const before = usePrevious({ count, filled });
  useEffect(() => {
    if (before && filled < before.filled && onScreen()) ghost.play(before);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filled]);
  const cells = (n: number, f: number, isGhost: boolean) =>
    Array.from({ length: n }, (_, i) => {
      const k = fromLeading ? i : n - 1 - i;
      return (
        <span key={i} className={styles.raceCell} data-ghost={isGhost || undefined}>
          <span className={styles.raceFill} style={{ background: color, opacity: k < f ? 1 : 0 }} data-instant={!isGhost && before != null && filled < before.filled ? true : undefined} />
        </span>
      );
    });
  return (
    <span className={styles.raceCells}>
      {cells(count, filled, false)}
      {ghost.moment ? (
        <span key={ghost.moment.id} className={styles.raceGhost} onAnimationEnd={() => ghost.done(ghost.moment!.id)}>
          {cells(ghost.moment.value.count, ghost.moment.value.filled, true)}
        </span>
      ) : null}
    </span>
  );
}

// MARK: - Mini bases

/** Three 3.5pt bases after the batting team's name in a small live tile (MiniBases). */
export function MiniBases({ state }: { state: BaseState }) {
  return (
    <span className={styles.miniBases} aria-hidden="true">
      <span data-on={state.onSecond} style={{ left: "calc(6.5 * var(--pt))", top: "calc(2 * var(--pt))" }} />
      <span data-on={state.onFirst} style={{ left: "calc(10.5 * var(--pt))", top: "calc(5.5 * var(--pt))" }} />
      <span data-on={state.onThird} style={{ left: "calc(2.5 * var(--pt))", top: "calc(5.5 * var(--pt))" }} />
    </span>
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
    case "counterStrike":
      return [s.live.mapName, `${s.live.topScore} to ${s.live.bottomScore}`, s.live.round != null ? `round ${s.live.round}` : null].filter(Boolean).join(", ");
    default:
      return null;
  }
}
